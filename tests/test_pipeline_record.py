"""
Tests for pipeline/record.py: what the result lines add up to.

Every game, line and score here is invented. The arithmetic is checked
against figures worked out by hand, which the comments show.
"""

import math
import random

import pytest

from pipeline import grading, record, store

HOME_WIN, HOME_LOSS = (112, 104), (104, 112)


def game(number, p_home, points, start="2026-10-20T23:00:00Z", home="BOS", away="NYK"):
    """A result line as the daily run writes it, graded by the rules of grading.py."""
    home_pts, away_pts = points
    line = p_home and {
        "p_home": p_home,
        "lo": p_home,
        "hi": p_home,
        "n": 1,
        "at": "2026-10-20T22:10:41Z",
    }
    return {
        "id": f"{number:032x}",
        "commence_time": start,
        "home": home,
        "away": away,
        "home_pts": home_pts,
        "away_pts": away_pts,
        "recorded_at": "2026-10-25T09:10:07Z",
        "market": line,
        "market_verdict": grading.verdict(p_home, home_pts, away_pts),
    }


def built(lines):
    return record.build(lines, sport="basketball_nba")


def test_41_wins_in_60_give_a_wilson_interval_of_56_to_79_percent():
    low, high = record.wilson(41, 60)

    assert (round(100 * low), round(100 * high)) == (56, 79)
    assert (round(low, 4), round(high, 4)) == (0.5577, 0.7869)


def test_the_record_of_41_favorites_that_won_and_19_that_lost():
    lines = [game(n, 0.7, HOME_WIN) for n in range(41)]
    lines += [game(n, 0.7, HOME_LOSS) for n in range(41, 60)]

    market = built(lines)["market"]

    assert (market["games"], market["wins"], market["losses"]) == (60, 41, 19)
    assert market["accuracy"] == 0.6833  # 41 / 60 = 0.68333
    assert market["accuracy_interval"] == [0.5577, 0.7869]


def test_the_wilson_interval_stays_between_0_and_1_and_is_never_a_point():
    def to_four_decimals(wins, games):
        return tuple(round(bound, 4) for bound in record.wilson(wins, games))

    assert to_four_decimals(0, 5) == (0.0, 0.4345)
    assert to_four_decimals(5, 5) == (0.5655, 1.0)
    # One win in two games says very little.
    assert to_four_decimals(1, 2) == (0.0945, 0.9055)
    assert record.wilson(0, 5)[0] == 0.0
    assert record.wilson(5, 5)[1] == 1.0


def test_the_interval_of_no_win_starts_at_0_and_that_of_no_loss_ends_at_1():
    # Left to floating point, the lower bound for no win in 21 games comes
    # out a hair below 0, which would be written as -0.0, and the upper bound
    # for 11 wins in 11 games a hair above 1.
    assert str(record.wilson(0, 21)[0]) == "0.0"
    assert record.wilson(11, 11)[1] == 1.0
    for games in range(1, 400):
        for low, high in (record.wilson(0, games), record.wilson(games, games)):
            assert 0 <= low < high <= 1

    lost_every_time = [game(n, 0.7, HOME_LOSS) for n in range(21)]
    assert '"accuracy_interval": [\n      0.0,' in store.to_json(built(lost_every_time))


def test_the_wilson_interval_holds_the_share_and_narrows_with_more_games():
    widths = []
    for games in (10, 100, 1000):
        low, high = record.wilson(games * 7 // 10, games)
        assert low < 0.7 < high
        widths.append(high - low)

    assert widths == sorted(widths, reverse=True)


# Four games with a line. The home team wins the first and the last.
#
#   p_home   home won   squared distance      probability given to what happened
#   0.6      yes        (1 - 0.6)^2 = 0.16      0.6    -ln = 0.510826
#   0.7      no         (0.7)^2     = 0.49      0.3    -ln = 1.203973
#   0.2      no         (0.2)^2     = 0.04      0.8    -ln = 0.223144
#   0.505    yes        (0.495)^2   = 0.245025  0.505  -ln = 0.683197
#
#   Brier score: 0.935025 / 4 = 0.23375625, written as 0.2338.
#   Log loss:    2.621140 / 4 = 0.655285,   written as 0.6553.
SCORED_BY_HAND = [
    game(1, 0.6, HOME_WIN),
    game(2, 0.7, HOME_LOSS),
    game(3, 0.2, HOME_LOSS),
    game(4, 0.505, HOME_WIN),
]


def test_the_brier_score_and_the_log_loss_against_figures_worked_out_by_hand():
    market = built(SCORED_BY_HAND)["market"]

    assert market["brier"] == 0.2338
    assert market["log_loss"] == 0.6553
    assert market["with_line"] == 4


def test_a_toss_up_is_scored_and_a_game_without_a_line_is_not():
    # The fourth game above is a toss-up, and it is one of the four scored.
    assert SCORED_BY_HAND[3]["market_verdict"] == "toss_up"
    without_a_line = [game(5, None, HOME_WIN), game(6, None, HOME_LOSS)]

    market = built(SCORED_BY_HAND + without_a_line)["market"]

    assert (market["brier"], market["log_loss"], market["with_line"]) == (0.2338, 0.6553, 4)
    assert (market["toss_ups"], market["not_graded"]) == (1, 2)
    # Three games had a favorite: 0.6 won, 0.7 lost, and the away team at 0.8 won.
    assert (market["games"], market["wins"], market["losses"]) == (3, 2, 1)
    # The accuracy is the share of those three, not of the six games.
    assert market["accuracy"] == 0.6667


def test_one_half_every_time_scores_0_25_and_0_6931():
    forecasts = [(0.5, True), (0.5, False), (0.5, False)]

    assert record.brier(forecasts) == 0.25
    assert round(record.log_loss(forecasts), 4) == 0.6931


@pytest.mark.parametrize(
    ("p_home", "band"),
    [
        (0.52, "52-59"),
        (0.5999, "52-59"),
        (0.6, "60-69"),
        (0.6999, "60-69"),
        (0.7, "70-79"),
        (0.7999, "70-79"),
        (0.8, "80-89"),
        (0.8999, "80-89"),
        (0.9, "90+"),
        (0.9999, "90+"),
        # An away favorite is sorted by its own probability, which is 1 - p_home.
        (0.48, "52-59"),
        (0.4001, "52-59"),
        (0.4, "60-69"),
        (0.3, "70-79"),
        (0.2001, "70-79"),
        (0.2, "80-89"),
        (0.1, "90+"),
        (0.0001, "90+"),
    ],
)
def test_a_favorite_is_in_the_band_its_probability_falls_in(p_home, band):
    bands = built([game(1, p_home, HOME_WIN)])["market"]["bands"]

    assert [row["band"] for row in bands if row["games"]] == [band]


def test_each_band_counts_its_games_and_wins_and_gives_the_mean_probability():
    lines = [
        game(1, 0.55, HOME_WIN),
        game(2, 0.58, HOME_LOSS),
        game(3, 0.43, HOME_LOSS),  # the away team at 0.57 won
        game(4, 0.75, HOME_WIN),
        game(5, 0.05, HOME_WIN),  # the away team at 0.95 lost
        game(6, 0.5, HOME_WIN),  # a toss-up is in no band
        game(7, None, HOME_WIN),
    ]

    assert built(lines)["market"]["bands"] == [
        # (0.55 + 0.58 + 0.57) / 3 = 0.5667
        {"band": "52-59", "games": 3, "wins": 2, "mean_p_favorite": 0.5667},
        {"band": "60-69", "games": 0, "wins": 0, "mean_p_favorite": None},
        {"band": "70-79", "games": 1, "wins": 1, "mean_p_favorite": 0.75},
        {"band": "80-89", "games": 0, "wins": 0, "mean_p_favorite": None},
        {"band": "90+", "games": 1, "wins": 0, "mean_p_favorite": 0.95},
    ]


def test_the_home_team_every_time_is_counted_over_every_game():
    lines = [
        game(1, 0.7, HOME_WIN),
        game(2, 0.3, HOME_LOSS),
        game(3, 0.5, HOME_WIN),  # a toss-up
        game(4, None, HOME_WIN),  # not graded
        game(5, None, HOME_LOSS),
    ]

    assert built(lines)["baseline_home"] == {"games": 5, "wins": 3}
    assert built(lines)["games"] == 5


def test_a_game_belongs_to_the_new_york_day_it_starts_on():
    lines = [
        # 19:00 and 22:30 on 20 October in New York. The second is 21 October in UTC.
        game(1, 0.7, HOME_WIN, "2026-10-20T23:00:00Z"),
        game(2, 0.7, HOME_LOSS, "2026-10-21T02:30:00Z"),
        game(3, 0.5, HOME_WIN, "2026-10-21T23:30:00Z"),
        game(4, None, HOME_WIN, "2026-10-22T00:00:00Z"),
        # 1 November 2026 at 00:30 UTC is still 31 October in New York.
        game(5, 0.3, HOME_LOSS, "2026-11-01T00:30:00Z"),
    ]

    result = built(lines)

    assert result["since"] == "2026-10-20"
    assert result["by_day"] == [
        {
            "day": "2026-10-20",
            "games": 2,
            "market": {"wins": 1, "losses": 1, "toss_ups": 0, "not_graded": 0},
        },
        {
            "day": "2026-10-21",
            "games": 2,
            "market": {"wins": 0, "losses": 0, "toss_ups": 1, "not_graded": 1},
        },
        {
            "day": "2026-10-31",
            "games": 1,
            "market": {"wins": 1, "losses": 0, "toss_ups": 0, "not_graded": 0},
        },
    ]


def test_the_three_biggest_upsets_are_the_lost_favorites_with_the_highest_probability():
    lines = [
        game(1, 0.62, HOME_LOSS, "2026-10-20T23:00:00Z"),
        game(2, 0.12, HOME_WIN, "2026-10-21T23:00:00Z", "MIA", "CHI"),  # CHI at 0.88 lost
        game(3, 0.95, HOME_WIN, "2026-10-22T23:00:00Z"),  # the biggest favorite, and it won
        game(4, 0.81, HOME_LOSS, "2026-10-23T23:00:00Z", "LAL", "GSW"),
        game(5, 0.55, HOME_LOSS, "2026-10-24T23:00:00Z"),
        game(6, 0.5, HOME_LOSS, "2026-10-25T23:00:00Z"),  # a toss-up has no favorite to upset
    ]

    assert built(lines)["market"]["biggest_upsets"] == [
        {
            "id": f"{2:032x}",
            "commence_time": "2026-10-21T23:00:00Z",
            "home": "MIA",
            "away": "CHI",
            "home_pts": 112,
            "away_pts": 104,
            "favorite": "CHI",
            "p_favorite": 0.88,
        },
        {
            "id": f"{4:032x}",
            "commence_time": "2026-10-23T23:00:00Z",
            "home": "LAL",
            "away": "GSW",
            "home_pts": 104,
            "away_pts": 112,
            "favorite": "LAL",
            "p_favorite": 0.81,
        },
        {
            "id": f"{1:032x}",
            "commence_time": "2026-10-20T23:00:00Z",
            "home": "BOS",
            "away": "NYK",
            "home_pts": 104,
            "away_pts": 112,
            "favorite": "BOS",
            "p_favorite": 0.62,
        },
    ]


def test_upsets_of_the_same_size_are_listed_in_order_of_start():
    lines = [game(n, 0.7, HOME_LOSS, f"2026-10-2{n}T23:00:00Z") for n in (4, 1, 3, 2)]

    upsets = built(lines)["market"]["biggest_upsets"]

    assert [upset["commence_time"][:10] for upset in upsets] == [
        "2026-10-21",
        "2026-10-22",
        "2026-10-23",
    ]


def test_the_record_before_the_first_game():
    assert built([]) == {
        "schema": 1,
        "sport": "basketball_nba",
        "since": None,
        "games": 0,
        "market": {
            "games": 0,
            "wins": 0,
            "losses": 0,
            "accuracy": None,
            "accuracy_interval": None,
            "toss_ups": 0,
            "not_graded": 0,
            "with_line": 0,
            "brier": None,
            "log_loss": None,
            "bands": [
                {"band": band, "games": 0, "wins": 0, "mean_p_favorite": None}
                for band in ("52-59", "60-69", "70-79", "80-89", "90+")
            ],
            "biggest_upsets": [],
        },
        "baseline_home": {"games": 0, "wins": 0},
        "by_day": [],
    }


def test_a_record_of_toss_ups_only_has_no_accuracy_and_is_still_scored():
    market = built([game(1, 0.51, HOME_WIN), game(2, 0.49, HOME_LOSS)])["market"]

    assert (market["games"], market["accuracy"], market["accuracy_interval"]) == (0, None, None)
    assert (market["toss_ups"], market["with_line"]) == (2, 2)
    assert market["brier"] == 0.2401  # (1 - 0.51)^2 and 0.49^2 are both 0.2401


def test_rebuilding_gives_the_same_bytes_whatever_order_the_lines_come_in():
    shuffle = random.Random(2026).shuffle
    lines = [
        game(n, p_home, points, f"2026-10-{20 + n % 9}T23:00:00Z")
        for n, (p_home, points) in enumerate(
            [(0.7, HOME_WIN), (0.31, HOME_WIN), (0.5, HOME_LOSS), (None, HOME_WIN)] * 12
        )
    ]
    first = store.to_json(built(lines))

    assert store.to_json(built(lines)) == first
    for _ in range(5):
        shuffle(lines)
        assert store.to_json(built(lines)) == first


def test_the_lines_are_not_changed_and_stay_in_the_order_they_were_given_in():
    # The later game comes first, as it can in a results file.
    lines = [
        game(1, 0.7, HOME_LOSS, "2026-10-21T23:00:00Z"),
        game(2, 0.3, HOME_WIN, "2026-10-20T23:00:00Z"),
    ]
    untouched = [dict(line, market=dict(line["market"])) for line in lines]

    built(lines)

    assert lines == untouched


def test_the_board_carries_the_wins_and_the_losses():
    lines = [game(1, 0.7, HOME_WIN), game(2, 0.7, HOME_WIN), game(3, 0.7, HOME_LOSS)]

    assert record.headline(built(lines)) == {"market": {"wins": 2, "losses": 1}}


# From here on: a sport that the two models forecast. Its result lines carry
# what each model said on the morning of the game, and the record gives each
# model what it gives the sportsbooks' line.
MODELS = ("elo", "points_rest")
MORNING = "2026-10-20T09:10:07Z"


def forecast(
    number,
    market,
    elo,
    points=HOME_WIN,
    points_rest=None,
    start="2026-10-20T23:00:00Z",
    published_at=MORNING,
    **teams,
):
    """
    A result line with the chance that each source gave the home team, or
    None for a source that gave none. A forecast that was not published
    before the start is in the line and is not graded.
    """
    line = game(number, market, points, start, **teams)
    for name, p_home in (("elo", elo), ("points_rest", points_rest)):
        counts = p_home is not None and published_at < start
        margin = {"margin": 1.5} if name == "points_rest" else {}
        line[name] = p_home and {"p_home": p_home, **margin, "published_at": published_at}
        line[f"{name}_verdict"] = grading.verdict(p_home if counts else None, *points)
    return line


def forecast_record(lines):
    return record.build(lines, sport="basketball_nba", models=MODELS)


# Five games with a line and a forecast by Elo.
#
#   line   Elo    home won   the line's pick   Elo's pick      Elo's squared distance
#   0.6    0.7    yes        home, right       home, right     0.09
#   0.6    0.45   no         home, wrong       away, right     0.2025
#   0.3    0.55   no         away, right       home, wrong     0.3025
#   0.7    0.51   yes        home, right       none            0.2401
#   0.4    0.2    yes        away, wrong       away, wrong     0.64
#
#   Elo's Brier score: 1.4751 / 5 = 0.29502. The line's: 1.06 / 5 = 0.212.
#   Elo's log loss: -(ln 0.7 + ln 0.55 + ln 0.45 + ln 0.51 + ln 0.2) / 5 = 0.80716.
FIVE_FORECASTS = [
    forecast(1, 0.6, 0.7, HOME_WIN),
    forecast(2, 0.6, 0.45, HOME_LOSS),
    forecast(3, 0.3, 0.55, HOME_LOSS),
    forecast(4, 0.7, 0.51, HOME_WIN),
    forecast(5, 0.4, 0.2, HOME_WIN),
]


def test_a_model_is_given_the_figures_that_the_sportsbooks_line_is_given():
    built = forecast_record(FIVE_FORECASTS)

    elo = built["elo"]
    assert (elo["games"], elo["wins"], elo["losses"]) == (4, 2, 2)
    assert (elo["toss_ups"], elo["not_graded"], elo["with_line"]) == (1, 0, 5)
    assert (elo["accuracy"], elo["accuracy_interval"]) == (0.5, [0.15, 0.85])
    assert (elo["brier"], elo["log_loss"]) == (0.295, 0.8072)
    # The bands are those of the side that Elo picked.
    assert [(band["band"], band["games"], band["wins"]) for band in elo["bands"]] == [
        ("52-59", 2, 1),
        ("60-69", 0, 0),
        ("70-79", 1, 1),
        ("80-89", 1, 0),
        ("90+", 0, 0),
    ]
    assert [upset["p_favorite"] for upset in elo["biggest_upsets"]] == [0.8, 0.55]
    # The sportsbooks' figures are what they are without the models.
    assert built["market"] == built_without_models(FIVE_FORECASTS)["market"]
    assert (built["market"]["wins"], built["market"]["losses"], built["market"]["brier"]) == (
        3,
        2,
        0.212,
    )


def built_without_models(lines):
    return record.build(lines, sport="basketball_nba")


def test_the_wilson_interval_of_two_wins_in_four_games():
    # Half of four: centre 0.5, reach 1.96 x sqrt(0.0625 + 0.0600) / 1.9604 = 0.35.
    low, high = record.wilson(2, 4)

    assert (round(low, 4), round(high, 4)) == (0.15, 0.85)


def test_a_model_without_a_forecast_for_a_game_is_not_graded_for_it():
    lines = [forecast(1, 0.6, 0.7, HOME_WIN, points_rest=0.65), forecast(2, 0.6, None, HOME_WIN)]

    built = forecast_record(lines)

    assert (built["elo"]["games"], built["elo"]["not_graded"], built["elo"]["with_line"]) == (
        1,
        1,
        1,
    )
    rest = built["points_rest"]
    assert (rest["games"], rest["wins"], rest["not_graded"], rest["brier"]) == (1, 1, 1, 0.1225)
    assert (built["elo"]["late"], rest["late"]) == (0, 0)


def test_a_line_from_before_the_models_were_added_counts_as_not_graded_for_them():
    lines = [game(1, 0.6, HOME_WIN), forecast(2, 0.6, 0.7, HOME_WIN)]

    built = forecast_record(lines)

    assert (built["games"], built["market"]["wins"]) == (2, 2)
    assert (built["elo"]["wins"], built["elo"]["not_graded"], built["elo"]["late"]) == (1, 1, 0)
    assert built["by_day"][0]["elo"] == {"wins": 1, "losses": 0, "toss_ups": 0, "not_graded": 1}
    assert built["elo"]["brier_against_market"]["games"] == 1


def test_a_forecast_that_came_too_late_is_counted_as_late_and_scored_nowhere():
    on_time = forecast(1, 0.6, 0.7, HOME_WIN, points_rest=0.7)
    # Published at the second the game started.
    late = forecast(2, 0.6, 0.9, HOME_LOSS, points_rest=0.9, published_at="2026-10-20T23:00:00Z")
    assert (late["elo"]["p_home"], late["elo_verdict"]) == (0.9, "not_graded")

    built = forecast_record([on_time, late])

    for name in MODELS:
        model = built[name]
        assert (model["late"], model["not_graded"], model["with_line"]) == (1, 1, 1)
        assert (model["games"], model["wins"], model["losses"]) == (1, 1, 0)
        # The one forecast that counts: (1 - 0.7)^2. The late one would have added 0.81.
        assert model["brier"] == 0.09
        assert model["picks_against_market"]["differ"] == 0
        assert model["brier_against_market"]["games"] == 1
    assert built["market"]["with_line"] == 2


def test_the_games_in_which_a_model_and_the_sportsbooks_picked_different_winners():
    picks = forecast_record(FIVE_FORECASTS)["elo"]["picks_against_market"]

    # The second and the third game. In the fourth Elo made no pick.
    assert (picks["differ"], picks["model_right"], picks["market_right"]) == (2, 1, 1)
    assert picks["latest"] == [
        {
            "id": f"{3:032x}",
            "commence_time": "2026-10-20T23:00:00Z",
            "home": "BOS",
            "away": "NYK",
            "home_pts": 104,
            "away_pts": 112,
            "pick": "BOS",
            "market_pick": "NYK",
            "right": "market",
        },
        {
            "id": f"{2:032x}",
            "commence_time": "2026-10-20T23:00:00Z",
            "home": "BOS",
            "away": "NYK",
            "home_pts": 104,
            "away_pts": 112,
            "pick": "NYK",
            "market_pick": "BOS",
            "right": "model",
        },
    ]


def test_a_game_without_a_pick_by_either_is_not_one_they_differed_in():
    lines = [
        forecast(1, 0.5, 0.3, HOME_WIN),  # the line was a toss-up, and Elo picked the away team
        forecast(2, 0.3, 0.5, HOME_WIN),  # Elo's forecast was a toss-up
        forecast(3, None, 0.7, HOME_WIN),  # no line
        forecast(4, 0.7, None, HOME_WIN),  # no forecast
        forecast(5, 0.7, 0.6, HOME_LOSS),  # both picked the home team
    ]

    picks = forecast_record(lines)["elo"]["picks_against_market"]

    assert picks == {"differ": 0, "model_right": 0, "market_right": 0, "latest": []}


def test_the_ten_latest_games_with_different_picks_are_listed_the_latest_first():
    lines = [
        forecast(day, 0.4, 0.6, HOME_WIN, start=f"2026-11-{day:02d}T23:00:00Z")
        for day in range(1, 15)
    ]

    picks = forecast_record(lines)["elo"]["picks_against_market"]

    assert (picks["differ"], picks["model_right"], picks["market_right"]) == (14, 14, 0)
    assert [game["commence_time"][8:10] for game in picks["latest"]] == [
        f"{day:02d}" for day in range(14, 4, -1)
    ]


def test_the_difference_in_brier_score_is_taken_game_by_game_over_the_games_both_forecast():
    # The differences of the five games are -0.07, -0.1575, 0.2125, 0.1501
    # and 0.28. They add up to 0.4151, and a fifth of that is 0.08302.
    lines = [*FIVE_FORECASTS, forecast(6, None, 0.9, HOME_WIN), forecast(7, 0.9, None, HOME_WIN)]

    against = forecast_record(lines)["elo"]["brier_against_market"]

    assert against == {"games": 5, "difference": 0.083, "interval": None}
    # It is the one Brier score minus the other when both are over the same games.
    built = forecast_record(FIVE_FORECASTS)
    assert against["difference"] == round(built["elo"]["brier"] - built["market"]["brier"], 4)


def test_the_difference_has_no_interval_before_thirty_games():
    one_short = [forecast(n, 0.6, 0.7, HOME_WIN) for n in range(29)]

    assert forecast_record(one_short)["elo"]["brier_against_market"] == {
        "games": 29,
        "difference": -0.07,
        "interval": None,
    }
    enough = forecast_record([*one_short, forecast(29, 0.6, 0.7, HOME_WIN)])
    # Thirty times the same difference: every resample has that mean.
    assert enough["elo"]["brier_against_market"] == {
        "games": 30,
        "difference": -0.07,
        "interval": [-0.07, -0.07],
    }
    assert enough["points_rest"]["brier_against_market"] == {
        "games": 0,
        "difference": None,
        "interval": None,
    }


def test_the_interval_is_about_two_standard_errors_either_side_of_the_difference():
    # Forty games. In half of them Elo was nearer by 0.07 and in the other
    # half the line was, by 0.07: the mean is 0, the standard deviation 0.07
    # and the standard error 0.07 / sqrt(40) = 0.0111.
    lines = [forecast(n, 0.6, 0.7, HOME_WIN) for n in range(20)]
    lines += [forecast(n, 0.7, 0.6, HOME_WIN) for n in range(20, 40)]

    against = forecast_record(lines)["elo"]["brier_against_market"]

    low, high = against["interval"]
    assert (against["games"], against["difference"]) == (40, 0.0)
    assert -0.025 < low < -0.019 and 0.019 < high < 0.025


def test_the_interval_comes_from_10000_resamples_with_a_fixed_seed():
    differences = [math.sin(n) / 10 for n in range(45)]

    low, high = record.bootstrap_interval(differences)

    # The same resampling, written out: each of the 10,000 draws 45 of the
    # values with replacement, and the interval runs from the 251st to the
    # 9,750th of the means in order.
    draw = random.Random(20261020).random
    means = sorted(
        math.fsum([differences[int(draw() * 45)] for _ in range(45)]) / 45 for _ in range(10_000)
    )
    assert (low, high) == (means[250], means[9749])
    assert means[249] < low < 0 < high < means[9750]
    assert record.bootstrap_interval(differences) == (low, high)
    assert (record.RESAMPLES, record.SEED) == (10_000, 20261020)


def test_each_day_has_a_tally_for_each_model():
    lines = [
        forecast(1, 0.6, 0.7, HOME_WIN, points_rest=0.5),
        forecast(2, 0.6, 0.7, HOME_LOSS, start="2026-10-21T23:00:00Z"),
    ]

    assert forecast_record(lines)["by_day"] == [
        {
            "day": "2026-10-20",
            "games": 1,
            "market": {"wins": 1, "losses": 0, "toss_ups": 0, "not_graded": 0},
            "elo": {"wins": 1, "losses": 0, "toss_ups": 0, "not_graded": 0},
            "points_rest": {"wins": 0, "losses": 0, "toss_ups": 1, "not_graded": 0},
        },
        {
            "day": "2026-10-21",
            "games": 1,
            "market": {"wins": 0, "losses": 1, "toss_ups": 0, "not_graded": 0},
            "elo": {"wins": 0, "losses": 1, "toss_ups": 0, "not_graded": 0},
            "points_rest": {"wins": 0, "losses": 0, "toss_ups": 0, "not_graded": 1},
        },
    ]


def test_the_record_of_a_forecast_sport_before_the_first_game():
    built = forecast_record([])

    for name in MODELS:
        assert built[name] == {
            **built["market"],
            "late": 0,
            "picks_against_market": {
                "differ": 0,
                "model_right": 0,
                "market_right": 0,
                "latest": [],
            },
            "brier_against_market": {"games": 0, "difference": None, "interval": None},
        }
    assert built_without_models([]).keys() == built.keys() - set(MODELS)


def test_the_record_with_models_gives_the_same_bytes_whatever_order_the_lines_come_in():
    shuffle = random.Random(2026).shuffle
    chances = [(0.7, 0.6, 0.55), (0.31, 0.6, 0.4), (0.5, 0.45, 0.7), (None, 0.8, None)]
    lines = [
        forecast(
            n,
            market,
            elo,
            HOME_WIN if n % 3 else HOME_LOSS,
            points_rest=rest,
            start=f"2026-10-{20 + n % 9}T23:00:00Z",
        )
        for n, (market, elo, rest) in enumerate(chances * 12)
    ]
    first = store.to_json(forecast_record(lines))

    assert '"interval": [' in first
    for _ in range(3):
        shuffle(lines)
        assert store.to_json(forecast_record(lines)) == first


def test_the_board_carries_the_wins_and_the_losses_of_each_model():
    built = forecast_record(FIVE_FORECASTS)

    assert record.headline(built, MODELS) == {
        "market": {"wins": 3, "losses": 2},
        "elo": {"wins": 2, "losses": 2},
        "points_rest": {"wins": 0, "losses": 0},
    }
    assert record.headline(built) == {"market": {"wins": 3, "losses": 2}}
