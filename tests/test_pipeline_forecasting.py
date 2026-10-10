"""
End-to-end tests for the models' part of the daily work of
`python -m pipeline snapshot`: in the day's first slot both models are
rebuilt from every result of the season, their forecasts for the games of
the day are frozen in a file that is never changed afterwards, and the games
that are over are graded against what the models said on the morning they
were played.

As in test_pipeline_daily.py the command runs against the fake server in
tests/fake_odds_api.py, with a dummy key and a clock the test sets. Every
game, price and score is invented, and nothing here reaches The Odds API.
"""

import errno
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fake_odds_api import FakeOddsApi, event, score_event
from pipeline import config, forecasts, model, record, snapshot, store
from pipeline.__main__ import main
from pipeline.model import elo, season

# A made-up value. It is deliberately not shaped like a real key.
KEY = "fake-key-not-a-real-one"
NBA, PRESEASON = "basketball_nba", "basketball_nba_preseason"
OPENING = season.load("2026_27").elo["ratings"]

# The first two days of the season. The slots that matter start at 21:10 on
# Monday evening in New York, at 05:10 and 18:10 on Tuesday and at 05:10 on
# Wednesday and on Thursday.
MONDAY_NIGHT = datetime(2026, 10, 20, 1, 10, 30, tzinfo=timezone.utc)
TUESDAY_MORNING = datetime(2026, 10, 20, 9, 10, 7, tzinfo=timezone.utc)
TUESDAY_EVENING = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
WEDNESDAY_MORNING = datetime(2026, 10, 21, 9, 10, 7, tzinfo=timezone.utc)
THURSDAY_MORNING = datetime(2026, 10, 22, 9, 10, 7, tzinfo=timezone.utc)
PUBLISHED_ON_TUESDAY, PUBLISHED_ON_WEDNESDAY = "2026-10-20T09:10:07Z", "2026-10-21T09:10:07Z"
TUESDAY_SLOT, WEDNESDAY_SLOT = "2026-10-20T05:10-04:00", "2026-10-21T05:10-04:00"
TUESDAYS_FORECASTS = "v1/predictions/2026-10-20.json"
WEDNESDAYS_FORECASTS = "v1/predictions/2026-10-21.json"
OCTOBER = "v1/results/2026-10.ndjson"


@dataclass(frozen=True)
class Game:
    id: str
    home: str
    away: str
    start: str
    home_share: float | None  # the line, or None when no sportsbook quotes the game
    points: tuple  # the final score


# Two games on Tuesday evening and two on Wednesday, in the first of which
# Boston plays for the second evening in a row.
#
# The sportsbooks have Boston at 0.58 against New York. Elo has it at 0.3965,
# because New York opens the season 113 points higher, and the
# points-and-rest model at about 0.44. New York wins.
BOS_NYK = Game(
    "1" * 32, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", 0.58, (104, 112)
)
# All three have the Lakers ahead of Golden State, and the Lakers lose.
LAL_GSW = Game(
    "2" * 32, "Los Angeles Lakers", "Golden State Warriors", "2026-10-21T02:00:00Z", 0.7, (99, 120)
)
DET_BOS = Game(
    "3" * 32, "Detroit Pistons", "Boston Celtics", "2026-10-21T23:00:00Z", 0.6, (101, 99)
)
HOU_SAS = Game(
    "4" * 32, "Houston Rockets", "San Antonio Spurs", "2026-10-22T00:00:00Z", 0.35, (88, 93)
)
TUESDAY, WEDNESDAY = [BOS_NYK, LAL_GSW], [DET_BOS, HOU_SAS]

# What Tuesday does to Elo, by hand.
#
# Boston, 1607, hosts New York, 1720, and loses 104 to 112.
#   Boston's chance was 1 / (1 + 10 ^ (73 / 400)) = 0.396464
#   multiplier 11 ^ 0.8 / (7.5 + 0.006 x 73) = 6.809483 / 7.938 = 0.857834
#   Boston loses 20 x 0.857834 x 0.396464 = 6.80: 1600.20 and 1726.80
#
# The Lakers, 1568, host Golden State, 1451, and lose 99 to 120.
#   their chance was 0.711723, and they lose 27.59: 1540.41 and 1478.59
AFTER_TUESDAY = {"BOS": 1600, "NYK": 1727, "LAL": 1540, "GSW": 1479}


def odds(games):
    """The games as the odds list them. The two prices of a home share h are 8(1 - h) and 8h."""
    return [
        event(
            game.id,
            game.home,
            game.away,
            game.start,
            {"Book A": (8 * (1 - game.home_share), 8 * game.home_share)} if game.home_share else {},
        )
        for game in games
    ]


def scores(over=(), not_over=(), sport=NBA):
    """The games as the scores list them: some completed, the others without a score yet."""
    listed = [
        score_event(game.id, game.home, game.away, game.start, game.points, sport=sport)
        for game in over
    ]
    listed += [
        score_event(game.id, game.home, game.away, game.start, None, completed=False, sport=sport)
        for game in not_over
    ]
    return listed


@dataclass
class Result:
    status: int
    out: str
    err: str
    outputs: dict  # what the command wrote to GITHUB_OUTPUT
    asked: list  # what each request of the run asked for, in order: "odds" or "scores"


@pytest.fixture
def api():
    with FakeOddsApi({NBA: odds(TUESDAY + WEDNESDAY)}) as fake:
        fake.scores = {NBA: scores(not_over=TUESDAY + WEDNESDAY)}
        yield fake


@pytest.fixture
def data_dir(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def run(api, data_dir, tmp_path, monkeypatch, capsys):
    """Runs the command the way the workflow does, at a time the test chooses."""
    github_output = tmp_path / "github_output"
    monkeypatch.setenv("ODDS_API_KEY", KEY)
    monkeypatch.setenv("ODDS_API_BASE_URL", api.url)
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    monkeypatch.delenv("PIPELINE_COMMIT", raising=False)

    def run(*options, now, into=data_dir):
        github_output.write_text("")
        before = len(api.requests)
        status = main(["snapshot", "--all", "--data-dir", str(into), *options], clock=lambda: now)
        printed = capsys.readouterr()
        written = github_output.read_text()
        for text in (printed.out, printed.err, written, *tree(into).values()):
            assert KEY not in text
        outputs = dict(line.split("=", 1) for line in written.splitlines())
        asked = [received.endpoint for received in api.requests[before:]]
        return Result(status, printed.out, printed.err, outputs, asked)

    return run


@pytest.fixture
def first_morning(run):
    """Monday night's snapshot has listed the games, and Tuesday's daily run has been done."""
    assert run(now=MONDAY_NIGHT).status == 0
    return run(now=TUESDAY_MORNING)


@pytest.fixture
def tuesday_played(api, run, first_morning):
    """And Tuesday's two games have been played."""
    assert run(now=TUESDAY_EVENING).status == 0
    api.scores = {NBA: scores(TUESDAY, not_over=WEDNESDAY)}


def tree(directory):
    """
    Every file under a directory, by relative path, with its content. One
    test puts a file there that is not text, and it is read all the same.
    """
    return {
        str(path.relative_to(directory)): path.read_text(errors="replace")
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def read(directory, path):
    return json.loads((directory / path).read_text())


def results_in(directory, path=OCTOBER):
    return [json.loads(line) for line in (directory / path).read_text().splitlines()]


def by_id(games):
    return {game["id"]: game for game in games}


def test_on_the_first_morning_both_models_are_at_their_opening_state(first_morning, data_dir):
    assert (first_morning.status, first_morning.err) == (0, "")
    assert first_morning.asked == ["scores", "odds"]
    assert first_morning.out.splitlines() == [
        f"Slot {TUESDAY_SLOT}. The next slot starts at 2026-10-20T09:10-04:00.",
        "basketball_nba -> v1/: 0 results, 0 not graded, 0 dropped. "
        "Credits: 497 remaining, 3 used, 2 spent on this call.",
        "basketball_nba -> v1/: Elo and points-and-rest from 0 results, "
        "2 games forecast for 2026-10-20.",
        f"Wrote {TUESDAYS_FORECASTS}, v1/model.json, v1/record.json, v1/state.json.",
        "basketball_nba -> v1/: 4 games, 4 with a line, 0 dropped. "
        "Credits: 496 remaining, 4 used, 1 spent on this call.",
        "Wrote v1/history/2026-10-20.ndjson, v1/slate.json, v1/state.json.",
    ]
    assert (first_morning.outputs["models"], first_morning.outputs["forecasts"]) == ("ok", "2")
    assert first_morning.outputs["written"] == "v1 0 results and 4 games"
    assert sorted(tree(data_dir)) == [
        "v1/history/2026-10-20.ndjson",
        "v1/model.json",
        TUESDAYS_FORECASTS,
        "v1/record.json",
        "v1/slate.json",
        "v1/state.json",
    ]

    built = read(data_dir, "v1/model.json")
    assert (built["built_at"], built["results_through"], built["games"]) == (
        PUBLISHED_ON_TUESDAY,
        None,
        0,
    )
    assert (built["status"], built["reasons"], built["code_commit"]) == ("ok", [], None)
    assert built["elo"]["ratings"] == {
        team: {"rating": rating, "week_ago": rating} for team, rating in OPENING.items()
    }
    assert len(built["points_rest"]["ratings"]) == 30
    assert all(built["teams"][team] == {"wins": 0, "losses": 0} for team in OPENING)


def test_the_first_morning_freezes_a_forecast_for_each_game_of_the_day(first_morning, data_dir):
    frozen = read(data_dir, TUESDAYS_FORECASTS)

    assert (frozen["day"], frozen["published_at"]) == ("2026-10-20", PUBLISHED_ON_TUESDAY)
    assert (frozen["status"], frozen["results_through"]) == ("ok", None)
    # Tuesday's two games, in order of start. Wednesday's get theirs on Wednesday.
    assert [game["id"] for game in frozen["games"]] == [BOS_NYK.id, LAL_GSW.id]
    boston, lakers = frozen["games"]
    assert boston["elo"] == {
        "p_home": 0.3965,
        "home_rating": 1607,
        "away_rating": 1720,
        "home_court": 40,
    }
    assert lakers["elo"]["p_home"] == 0.7117
    # The points-and-rest model has New York 2.94 points better than Boston,
    # and gives Boston 1.09 for playing at home. A margin of -1.85 with a
    # standard deviation of 11.87 is 0.156 of one below even, and 43.82% of
    # a normal distribution lies below that.
    assert boston["points_rest"] == {
        "p_home": 0.4382,
        "margin": -1.85,
        "rating_edge": -2.94,
        "home_court": 1.09,
        "rest_edge": 0.0,
    }
    # The line is the one that Monday night's snapshot stored.
    assert boston["market"] == {
        "p_home": 0.58,
        "lo": 0.58,
        "hi": 0.58,
        "n": 1,
        "at": "2026-10-20T01:10:30Z",
    }


def test_the_board_of_the_first_morning_carries_the_forecasts(first_morning, data_dir):
    slate = read(data_dir, "v1/slate.json")
    frozen = by_id(read(data_dir, TUESDAYS_FORECASTS)["games"])
    board = by_id(slate["games"])

    assert slate["models"] == {
        "results_through": None,
        "status": "ok",
        "predictions_day": "2026-10-20",
    }
    for game in TUESDAY:
        assert board[game.id]["elo"] == {"p_home": frozen[game.id]["elo"]["p_home"]}
        assert board[game.id]["points_rest"] == frozen[game.id]["points_rest"]
    # Wednesday's games have Elo's chance as the ratings stand, and no
    # forecast of the points-and-rest model before Wednesday morning.
    assert board[DET_BOS.id]["elo"] == {"p_home": round(elo.win_probability(1614, 1607, 40), 4)}
    assert board[DET_BOS.id]["points_rest"] is None
    assert board[HOU_SAS.id]["points_rest"] is None
    assert slate["record"] == {
        "market": {"wins": 0, "losses": 0},
        "elo": {"wins": 0, "losses": 0},
        "points_rest": {"wins": 0, "losses": 0},
    }


@pytest.mark.usefixtures("tuesday_played")
def test_on_the_second_morning_yesterdays_games_are_graded_for_all_three(run, data_dir):
    result = run(now=WEDNESDAY_MORNING)

    assert (result.status, result.err, result.asked) == (0, "", ["scores", "odds"])
    assert result.out.splitlines()[1:4] == [
        "basketball_nba -> v1/: 2 results, 0 not graded, 0 dropped. "
        "Credits: 493 remaining, 7 used, 2 spent on this call.",
        "basketball_nba -> v1/: Elo and points-and-rest from 2 results through 2026-10-20, "
        "2 games forecast for 2026-10-21.",
        f"Wrote {OCTOBER}, {WEDNESDAYS_FORECASTS}, v1/model.json, v1/record.json, v1/state.json.",
    ]
    boston, lakers = results_in(data_dir)
    # New York won in Boston. The sportsbooks had Boston, and both models New York.
    assert (boston["home_pts"], boston["away_pts"]) == (104, 112)
    assert (boston["market"]["p_home"], boston["market_verdict"]) == (0.58, "upset")
    assert boston["elo"] == {"p_home": 0.3965, "published_at": PUBLISHED_ON_TUESDAY}
    assert boston["points_rest"] == {
        "p_home": 0.4382,
        "margin": -1.85,
        "published_at": PUBLISHED_ON_TUESDAY,
    }
    assert (boston["elo_verdict"], boston["points_rest_verdict"]) == (
        "favorite_won",
        "favorite_won",
    )
    # Golden State won in Los Angeles, against all three.
    assert [lakers[f"{source}_verdict"] for source in ("market", *model.NAMES)] == ["upset"] * 3
    assert lakers["elo"]["p_home"] == 0.7117


@pytest.mark.usefixtures("tuesday_played")
def test_the_results_move_the_ratings_of_exactly_the_teams_that_played(run, data_dir):
    before = read(data_dir, "v1/model.json")

    run(now=WEDNESDAY_MORNING)

    built = read(data_dir, "v1/model.json")
    assert (built["results_through"], built["games"], built["status"]) == ("2026-10-20", 2, "ok")
    ratings = built["elo"]["ratings"]
    assert {team: ratings[team]["rating"] for team in AFTER_TUESDAY} == AFTER_TUESDAY
    assert {team for team in ratings if ratings[team] != before["elo"]["ratings"][team]} == {
        "BOS",
        "NYK",
        "LAL",
        "GSW",
    }
    # No rating is a week old yet.
    assert all(ratings[team]["week_ago"] == OPENING[team] for team in ratings)
    after, opening = built["points_rest"]["ratings"], before["points_rest"]["ratings"]
    assert after["NYK"]["rating"] > opening["NYK"]["rating"]
    assert after["LAL"]["rating"] < opening["LAL"]["rating"]
    assert after["DET"]["uncertainty"] == opening["DET"]["uncertainty"]
    assert after["BOS"]["uncertainty"] < opening["BOS"]["uncertainty"]
    assert built["teams"]["NYK"] == {"wins": 1, "losses": 0}
    assert built["teams"]["BOS"] == {"wins": 0, "losses": 1}
    assert built["teams"]["DET"] == {"wins": 0, "losses": 0}


@pytest.mark.usefixtures("tuesday_played")
def test_the_second_morning_leaves_yesterdays_forecasts_as_they_are(run, data_dir):
    frozen = (data_dir / TUESDAYS_FORECASTS).read_bytes()

    run(now=WEDNESDAY_MORNING)

    assert (data_dir / TUESDAYS_FORECASTS).read_bytes() == frozen
    today = read(data_dir, WEDNESDAYS_FORECASTS)
    assert (today["day"], today["published_at"]) == ("2026-10-21", PUBLISHED_ON_WEDNESDAY)
    assert today["results_through"] == "2026-10-20"
    detroit, houston = today["games"]
    # Detroit, 1614, hosts Boston, 1600 since last night:
    # 10 ^ (-(1614 + 40 - 1600) / 400) = 0.732825, and 1 / 1.732825 = 0.5771.
    assert detroit["elo"] == {
        "p_home": 0.5771,
        "home_rating": 1614,
        "away_rating": 1600,
        "home_court": 40,
    }
    # Boston played last night: 1.71 points for a visitor's back-to-back
    # and 0.32 for its one game more in the last seven days.
    assert detroit["points_rest"]["rest_edge"] == 2.02
    assert houston["points_rest"]["rest_edge"] == 0.0
    # The line is the one of Tuesday's 18:10 snapshot, the last before the daily run.
    assert detroit["market"]["at"] == "2026-10-20T22:10:41Z"


@pytest.mark.usefixtures("tuesday_played")
def test_the_record_gives_each_model_what_it_gives_the_sportsbooks(run, data_dir):
    run(now=WEDNESDAY_MORNING)

    built = read(data_dir, "v1/record.json")
    assert built == record.build(results_in(data_dir), sport=NBA, models=model.NAMES)
    assert (built["market"]["wins"], built["market"]["losses"]) == (0, 2)
    for name in model.NAMES:
        assert (built[name]["games"], built[name]["wins"], built[name]["losses"]) == (2, 1, 1)
        assert (built[name]["accuracy"], built[name]["late"]) == (0.5, 0)
        # In Boston the model and the sportsbooks picked different winners.
        picks = built[name]["picks_against_market"]
        assert (picks["differ"], picks["model_right"], picks["market_right"]) == (1, 1, 0)
        assert [game["id"] for game in picks["latest"]] == [BOS_NYK.id]
        assert built[name]["brier_against_market"]["games"] == 2
        assert built[name]["brier_against_market"]["interval"] is None
    # Elo: (0 - 0.3965)^2 = 0.1572 and (0 - 0.7117)^2 = 0.5065, mean 0.3319.
    # The line: 0.58^2 = 0.3364 and 0.7^2 = 0.49, mean 0.4132.
    assert (built["elo"]["brier"], built["market"]["brier"]) == (0.3319, 0.4132)
    assert built["elo"]["brier_against_market"]["difference"] == -0.0813
    assert read(data_dir, "v1/slate.json")["record"] == {
        "market": {"wins": 0, "losses": 2},
        "elo": {"wins": 1, "losses": 1},
        "points_rest": {"wins": 1, "losses": 1},
    }


@pytest.mark.usefixtures("tuesday_played")
def test_the_board_of_the_second_morning_carries_the_new_forecasts_and_the_graded_results(
    run, data_dir
):
    run(now=WEDNESDAY_MORNING)

    slate = read(data_dir, "v1/slate.json")
    frozen = by_id(read(data_dir, WEDNESDAYS_FORECASTS)["games"])
    assert slate["models"] == {
        "results_through": "2026-10-20",
        "status": "ok",
        "predictions_day": "2026-10-21",
    }
    assert [game["id"] for game in slate["games"]] == [DET_BOS.id, HOU_SAS.id]
    for game in slate["games"]:
        assert game["elo"] == {"p_home": frozen[game["id"]]["elo"]["p_home"]}
        assert game["points_rest"] == frozen[game["id"]]["points_rest"]
    assert slate["recent_results"] == results_in(data_dir)
    assert [line["elo_verdict"] for line in slate["recent_results"]] == ["favorite_won", "upset"]


def test_no_later_run_of_the_day_changes_the_forecasts(first_morning, run, api, data_dir):
    frozen = (data_dir / TUESDAYS_FORECASTS).read_bytes()
    # The line of the game in Boston moves during the day.
    moved = Game(BOS_NYK.id, BOS_NYK.home, BOS_NYK.away, BOS_NYK.start, 0.4, BOS_NYK.points)
    api.events[NBA] = odds([moved, LAL_GSW, *WEDNESDAY])

    # The other triggers of the slot, and the slots of the day up to 18:10.
    for hours in (0.5, 1, 4, 7, 10, 13):
        result = run(now=TUESDAY_MORNING + timedelta(hours=hours))
        assert result.status == 0
        assert (data_dir / TUESDAYS_FORECASTS).read_bytes() == frozen

    # The board has the new line next to the forecast of the morning.
    boston = by_id(read(data_dir, "v1/slate.json")["games"])[BOS_NYK.id]
    assert (boston["line"]["p_home"], boston["elo"]) == (0.4, {"p_home": 0.3965})
    assert boston["points_rest"]["margin"] == -1.85
    # A run by hand takes another snapshot and leaves the forecasts alone as well.
    forced = run("--force", now=TUESDAY_MORNING + timedelta(hours=13, minutes=20))
    assert (forced.status, forced.asked) == (0, ["odds"])
    assert (data_dir / TUESDAYS_FORECASTS).read_bytes() == frozen


def no_space_left(monkeypatch, only_for):
    """Makes the move of a file into place fail when its path has the name given in it."""
    replace = os.replace

    def failing_replace(source, destination):
        if only_for in Path(destination).parts:
            raise OSError(errno.ENOSPC, "No space left on device")
        replace(source, destination)

    monkeypatch.setattr(store.os, "replace", failing_replace)


def test_daily_work_that_is_done_again_finds_the_forecasts_published_and_leaves_them(
    run, api, data_dir, monkeypatch
):
    run(now=MONDAY_NIGHT)
    # From Tuesday morning the odds list one more game of the day.
    late_addition = Game("5" * 32, "Miami Heat", "Chicago Bulls", "2026-10-21T00:30:00Z", 0.5, ())
    api.events[NBA] = odds([*TUESDAY, *WEDNESDAY, late_addition])
    # The forecasts are moved into place, and then the move of the state
    # file fails, once: the daily work is not on record. The snapshot that
    # follows it in the same run is written, and with it the state knows the
    # game that was added.
    replace, failed_once = os.replace, []

    def failing_once(source, destination):
        if Path(destination).name == "state.json" and not failed_once:
            failed_once.append(destination)
            raise OSError(errno.ENOSPC, "No space left on device")
        replace(source, destination)

    monkeypatch.setattr(store.os, "replace", failing_once)
    failed = run(now=TUESDAY_MORNING)
    assert (failed.status, failed.asked) == (1, ["scores", "odds"])
    frozen = (data_dir / TUESDAYS_FORECASTS).read_bytes()
    state = read(data_dir, "v1/state.json")
    assert (state["results"], state["models"]) == (None, None)
    assert late_addition.id in state["games"]

    result = run(now=TUESDAY_MORNING + timedelta(minutes=30))

    assert (result.status, result.asked) == (0, ["scores"])
    assert result.out.splitlines()[2:] == [
        "basketball_nba -> v1/: Elo and points-and-rest from 0 results, "
        "the forecasts for 2026-10-20 are published already.",
        "Wrote v1/model.json, v1/record.json, v1/state.json.",
    ]
    assert result.outputs["forecasts"] == "0"
    assert (data_dir / TUESDAYS_FORECASTS).read_bytes() == frozen
    # The state notes the file as it is. The game that came too late for it
    # has no forecast, and the line that the snapshot took is not in it.
    state = read(data_dir, "v1/state.json")
    assert state["models"]["predictions"] == json.loads(frozen)
    assert state["models"]["built_at"] == "2026-10-20T09:40:07Z"
    assert [game["id"] for game in json.loads(frozen)["games"]] == [BOS_NYK.id, LAL_GSW.id]
    assert json.loads(frozen)["games"][0]["market"]["at"] == "2026-10-20T01:10:30Z"


def test_a_predictions_file_that_is_there_is_never_written_over_whatever_is_in_it(run, data_dir):
    run(now=MONDAY_NIGHT)
    # Somebody else's forecasts for the day: published earlier, and without a line.
    elsewhere = data_dir.with_name("elsewhere")
    run(now=MONDAY_NIGHT, into=elsewhere)
    run(now=TUESDAY_MORNING, into=elsewhere)
    theirs = read(elsewhere, TUESDAYS_FORECASTS)
    theirs["published_at"] = "2026-10-20T08:00:00Z"
    theirs["games"][0]["market"] = None
    (data_dir / "v1/predictions").mkdir()
    (data_dir / TUESDAYS_FORECASTS).write_text(store.to_json(theirs))

    result = run(now=TUESDAY_MORNING)

    assert result.status == 0
    assert "the forecasts for 2026-10-20 are published already" in result.out
    assert read(data_dir, TUESDAYS_FORECASTS) == theirs
    assert read(data_dir, "v1/state.json")["models"]["predictions"] == theirs


def test_a_forecast_published_after_the_start_the_scores_give_is_not_graded(run, api, data_dir):
    # Nothing ran on Tuesday morning. The daily work is done by hand at
    # 18:50 in New York, ten minutes before the game in Boston is to start.
    run(now=MONDAY_NIGHT)
    by_hand = datetime(2026, 10, 20, 22, 50, 0, tzinfo=timezone.utc)
    assert run("--force", now=by_hand).asked == ["scores", "odds"]
    assert read(data_dir, TUESDAYS_FORECASTS)["published_at"] == "2026-10-20T22:50:00Z"
    # The scores say afterwards that the game started at 22:45:38.
    api.scores[NBA] = [
        score_event(BOS_NYK.id, BOS_NYK.home, BOS_NYK.away, "2026-10-20T22:45:38Z", (104, 112)),
        *scores([LAL_GSW], not_over=WEDNESDAY),
    ]

    result = run(now=WEDNESDAY_MORNING)

    assert result.status == 0
    assert (
        f"  not graded event {BOS_NYK.id}: its forecasts were published at "
        "2026-10-20T22:50:00Z, which is not before the start at 2026-10-20T22:45:38Z"
    ) in result.out.splitlines()
    boston, lakers = results_in(data_dir)
    # The forecasts are in the line, and neither is graded.
    assert boston["elo"] == {"p_home": 0.3965, "published_at": "2026-10-20T22:50:00Z"}
    assert (boston["elo_verdict"], boston["points_rest_verdict"]) == ("not_graded", "not_graded")
    assert lakers["elo_verdict"] == "upset"
    built = read(data_dir, "v1/record.json")
    for name in model.NAMES:
        assert (built[name]["late"], built[name]["not_graded"], built[name]["games"]) == (1, 1, 1)
        assert built[name]["brier_against_market"]["games"] == 1


def test_a_game_that_was_never_forecast_is_not_graded_for_the_models(run, api, data_dir):
    # The job starts on Tuesday evening: there was no daily run that morning.
    run(now=TUESDAY_EVENING)
    api.scores[NBA] = scores(TUESDAY, not_over=WEDNESDAY)

    run(now=WEDNESDAY_MORNING)

    for line in results_in(data_dir):
        assert (line["elo"], line["elo_verdict"]) == (None, "not_graded")
        assert (line["points_rest"], line["points_rest_verdict"]) == (None, "not_graded")
        assert line["market_verdict"] == "upset"
    built = read(data_dir, "v1/record.json")
    assert (built["elo"]["not_graded"], built["elo"]["late"]) == (2, 0)
    # The models are built from the results all the same.
    assert read(data_dir, "v1/model.json")["games"] == 2


@pytest.mark.usefixtures("tuesday_played")
def test_with_a_result_missing_elo_is_published_alone_and_the_model_file_says_why(
    run, api, data_dir
):
    # On Wednesday morning the game in Los Angeles, which started seven
    # hours ago, is still not reported as over.
    api.scores[NBA] = scores([BOS_NYK], not_over=[LAL_GSW, *WEDNESDAY])
    missing = f"no result for GSW at LAL, which started at 2026-10-21T02:00:00Z (game {LAL_GSW.id})"

    result = run(now=WEDNESDAY_MORNING)

    assert (result.status, result.err) == (0, "")
    assert result.out.splitlines()[2:4] == [
        "basketball_nba -> v1/: Elo alone from 1 result through 2026-10-20, "
        "2 games forecast for 2026-10-21.",
        f"  points-and-rest left out: {missing}",
    ]
    assert (result.outputs["models"], result.outputs["forecasts"]) == ("degraded", "2")
    built = read(data_dir, "v1/model.json")
    assert (built["status"], built["reasons"], built["points_rest"]) == (
        "degraded",
        [missing],
        None,
    )
    # Elo has the one result there is.
    assert built["elo"]["ratings"]["BOS"]["rating"] == AFTER_TUESDAY["BOS"]
    assert built["elo"]["ratings"]["LAL"]["rating"] == OPENING["LAL"]
    today = read(data_dir, WEDNESDAYS_FORECASTS)
    assert (today["status"], today["reasons"]) == ("degraded", [missing])
    assert [game["points_rest"] for game in today["games"]] == [None, None]
    assert today["games"][0]["elo"]["p_home"] == 0.5771
    slate = read(data_dir, "v1/slate.json")
    assert slate["models"]["status"] == "degraded"
    assert [(game["elo"], game["points_rest"]) for game in slate["games"]] == [
        ({"p_home": 0.5771}, None),
        ({"p_home": 0.3733}, None),
    ]


@pytest.mark.usefixtures("tuesday_played")
def test_the_day_after_the_result_arrives_and_both_models_are_built_again(run, api, data_dir):
    api.scores[NBA] = scores([BOS_NYK], not_over=[LAL_GSW, *WEDNESDAY])
    run(now=WEDNESDAY_MORNING)
    api.scores[NBA] = scores([*TUESDAY, *WEDNESDAY])

    result = run(now=THURSDAY_MORNING)

    assert (result.status, result.outputs["models"]) == (0, "ok")
    built = read(data_dir, "v1/model.json")
    assert (built["status"], built["games"], built["results_through"]) == ("ok", 4, "2026-10-21")
    assert built["points_rest"] is not None
    # Wednesday's games had Elo's forecast and no other.
    detroit = results_in(data_dir)[2]
    assert (detroit["id"], detroit["home_pts"], detroit["away_pts"]) == (DET_BOS.id, 101, 99)
    assert (detroit["elo"]["p_home"], detroit["elo_verdict"]) == (0.5771, "favorite_won")
    assert (detroit["points_rest"], detroit["points_rest_verdict"]) == (None, "not_graded")
    counted = read(data_dir, "v1/record.json")
    assert (counted["elo"]["games"], counted["points_rest"]["games"]) == (4, 2)
    assert (counted["points_rest"]["not_graded"], counted["points_rest"]["late"]) == (2, 0)


def test_a_morning_that_was_missed_leaves_the_same_model_file_as_one_that_was_not(
    run, api, data_dir, tmp_path
):
    # Two data directories go through the same days. In the second, nothing
    # runs on Wednesday morning.
    daily, with_a_gap = data_dir, tmp_path / "with-a-gap"
    for directory in (daily, with_a_gap):
        api.scores[NBA] = scores(not_over=TUESDAY + WEDNESDAY)
        run(now=MONDAY_NIGHT, into=directory)
        run(now=TUESDAY_MORNING, into=directory)
        run(now=TUESDAY_EVENING, into=directory)
        api.scores[NBA] = scores(TUESDAY, not_over=WEDNESDAY)
        if directory is daily:
            run(now=WEDNESDAY_MORNING, into=directory)
        api.scores[NBA] = scores(TUESDAY + WEDNESDAY)
        assert run(now=THURSDAY_MORNING, into=directory).status == 0

    assert len(results_in(with_a_gap)) == 4
    assert (with_a_gap / "v1/model.json").read_bytes() == (daily / "v1/model.json").read_bytes()
    # What differs is what the missed morning would have frozen: Wednesday's
    # games have no forecast in the second directory.
    assert not (with_a_gap / WEDNESDAYS_FORECASTS).exists()
    assert [line["elo_verdict"] for line in results_in(with_a_gap)[2:]] == ["not_graded"] * 2
    assert [line["elo_verdict"] for line in results_in(daily)[2:]] == ["favorite_won"] * 2


@pytest.mark.usefixtures("tuesday_played")
def test_the_same_morning_run_twice_writes_the_same_bytes(run, api, data_dir, tmp_path):
    # A copy of the data directory as it is before Wednesday's daily run.
    copy = tmp_path / "copy"
    for path, content in tree(data_dir).items():
        (copy / path).parent.mkdir(parents=True, exist_ok=True)
        (copy / path).write_text(content)
    credits = api.remaining, api.used

    run(now=WEDNESDAY_MORNING)
    # The provider reports the same credits to the second run as to the first.
    api.remaining, api.used = credits
    run(now=WEDNESDAY_MORNING, into=copy)

    assert tree(copy) == tree(data_dir)
    assert sorted(tree(data_dir)) == [
        "v1/history/2026-10-20.ndjson",
        "v1/history/2026-10-21.ndjson",
        "v1/model.json",
        TUESDAYS_FORECASTS,
        WEDNESDAYS_FORECASTS,
        "v1/record.json",
        OCTOBER,
        "v1/slate.json",
        "v1/state.json",
    ]


@pytest.mark.usefixtures("first_morning")
def test_the_model_file_and_the_forecasts_name_the_commit_that_the_workflow_passes_on(
    run, data_dir, monkeypatch, tmp_path
):
    commit = "0123456789abcdef0123456789abcdef01234567"
    assert read(data_dir, "v1/model.json")["code_commit"] is None

    monkeypatch.setenv("PIPELINE_COMMIT", commit)
    run(now=MONDAY_NIGHT, into=tmp_path / "with-a-commit")
    run(now=TUESDAY_MORNING, into=tmp_path / "with-a-commit")

    assert read(tmp_path / "with-a-commit", "v1/model.json")["code_commit"] == commit
    assert read(tmp_path / "with-a-commit", TUESDAYS_FORECASTS)["code_commit"] == commit
    # Anything that is not a commit is left out and does not stop the run.
    monkeypatch.setenv("PIPELINE_COMMIT", "main")
    assert run(now=MONDAY_NIGHT, into=tmp_path / "with-a-name").status == 0
    assert run(now=TUESDAY_MORNING, into=tmp_path / "with-a-name").status == 0
    assert read(tmp_path / "with-a-name", "v1/model.json")["code_commit"] is None


@pytest.mark.usefixtures("tuesday_played")
def test_a_dry_run_builds_the_models_and_writes_nothing(run, data_dir):
    before = tree(data_dir)

    result = run("--dry-run", now=WEDNESDAY_MORNING)

    assert (result.status, result.asked) == (0, ["scores", "odds"])
    assert (
        "basketball_nba -> v1/: Elo and points-and-rest from 2 results through 2026-10-20, "
        "2 games forecast for 2026-10-21."
    ) in result.out.splitlines()
    assert (result.outputs["models"], result.outputs["forecasts"]) == ("ok", "2")
    assert tree(data_dir) == before


def test_the_preseason_rehearsal_is_recorded_and_graded_and_never_forecast(run, api, data_dir):
    # Tuesday 13 October, when the preseason is still captured. The same
    # game is listed for both sports, a week before the season starts.
    monday_night = datetime(2026, 10, 13, 1, 10, 30, tzinfo=timezone.utc)
    wednesday_morning = datetime(2026, 10, 14, 9, 10, 7, tzinfo=timezone.utc)
    game = Game(BOS_NYK.id, BOS_NYK.home, BOS_NYK.away, "2026-10-13T23:00:00Z", 0.6, (104, 112))
    api.events = {NBA: odds([game]), PRESEASON: odds([game])}
    api.scores = {NBA: scores(not_over=[game]), PRESEASON: scores(not_over=[game], sport=PRESEASON)}
    assert run(now=monday_night).status == 0
    api.scores = {NBA: scores([game]), PRESEASON: scores([game], sport=PRESEASON)}

    result = run(now=wednesday_morning)

    assert (result.status, result.asked) == (0, ["scores", "odds"] * 2)
    assert result.outputs["written"] == "v1 1 result and 0 games, v1-dryrun 1 result and 0 games"
    files = sorted(tree(data_dir))
    assert [path for path in files if path.startswith("v1-dryrun/")] == [
        "v1-dryrun/history/2026-10-13.ndjson",
        "v1-dryrun/record.json",
        "v1-dryrun/results/2026-10.ndjson",
        "v1-dryrun/slate.json",
        "v1-dryrun/state.json",
    ]
    assert "v1/model.json" in files
    (line,) = results_in(data_dir, "v1-dryrun/results/2026-10.ndjson")
    assert list(line)[-1] == "market_verdict" and len(line) == 9
    rehearsal = read(data_dir, "v1-dryrun/record.json")
    assert "elo" not in rehearsal and "points_rest" not in rehearsal
    assert "models" not in read(data_dir, "v1-dryrun/state.json")
    assert "models" not in read(data_dir, "v1-dryrun/slate.json")
    assert read(data_dir, "v1-dryrun/slate.json")["record"] == {"market": {"wins": 0, "losses": 1}}
    # Under the main prefix a game of 13 October is recorded and graded
    # against the line, and it is not a game of the season: the models are
    # where the opening files put them.
    assert (
        "basketball_nba -> v1/: Elo and points-and-rest from 0 results, "
        "no game to forecast for 2026-10-14."
    ) in result.out.splitlines()
    built = read(data_dir, "v1/model.json")
    assert (built["games"], built["results_through"], built["status"]) == (0, None, "ok")
    assert built["elo"]["ratings"]["BOS"] == {"rating": 1607, "week_ago": 1607}
    assert read(data_dir, "v1/record.json")["games"] == 1
    assert len(results_in(data_dir)[0]) == 13


def test_a_sport_written_under_a_prefix_of_the_callers_choice_is_not_forecast(
    api, data_dir, monkeypatch, capsys
):
    monkeypatch.setenv("ODDS_API_KEY", KEY)
    monkeypatch.setenv("ODDS_API_BASE_URL", api.url)
    arguments = ["snapshot", "--sport", NBA, "--prefix", "scratch", "--data-dir", str(data_dir)]

    assert main(arguments, clock=lambda: TUESDAY_MORNING) == 0

    capsys.readouterr()
    assert sorted(tree(data_dir)) == [
        "scratch/history/2026-10-20.ndjson",
        "scratch/record.json",
        "scratch/slate.json",
        "scratch/state.json",
    ]


def as_before_the_models(data_dir):
    """
    Rewrites a data directory to what the job left in it before the models
    were added: result lines of nine fields, a state and a board that know
    the record of the sportsbooks alone, and no file of the models. Returns
    the content of the results file.
    """
    lines = [dict(list(line.items())[:9]) for line in results_in(data_dir)]
    (data_dir / OCTOBER).write_text(store.to_ndjson(lines))
    (data_dir / "v1/record.json").write_text(store.to_json(record.build(lines, sport=NBA)))
    (data_dir / "v1/model.json").unlink()
    for path in (data_dir / "v1/predictions").iterdir():
        path.unlink()
    (data_dir / "v1/predictions").rmdir()
    state, slate = read(data_dir, "v1/state.json"), read(data_dir, "v1/slate.json")
    del state["models"], slate["models"]
    state["results"]["record"] = slate["record"] = {"market": slate["record"]["market"]}
    state["results"]["recent"] = slate["recent_results"] = lines
    for game in slate["games"]:
        del game["elo"], game["points_rest"]
    (data_dir / "v1/state.json").write_text(store.to_json(state))
    (data_dir / "v1/slate.json").write_text(store.to_json(slate))
    return store.to_ndjson(lines)


@pytest.mark.usefixtures("tuesday_played")
def test_files_from_before_the_models_are_continued_from(run, api, data_dir):
    # The data branch was started by the job as it was before the models
    # were added, and the job as it is now has to go on from those files.
    assert run(now=WEDNESDAY_MORNING).status == 0
    old_lines = as_before_the_models(data_dir)
    assert [list(line)[-1] for line in results_in(data_dir)] == ["market_verdict"] * 2

    # A snapshot comes first, at 18:10 on Wednesday. No daily run has built
    # the models yet, so the board has no forecast to show, and it shows the
    # record that it was left.
    result = run(now=WEDNESDAY_MORNING + timedelta(hours=13))

    assert (result.status, result.asked) == (0, ["odds"])
    slate = read(data_dir, "v1/slate.json")
    assert slate["models"] is None and read(data_dir, "v1/state.json")["models"] is None
    assert [(game["elo"], game["points_rest"]) for game in slate["games"]] == [(None, None)] * 2
    assert slate["record"] == {"market": {"wins": 0, "losses": 2}}

    # The daily run of the next morning adds to the old lines and does not
    # touch them, and it replays both models through every result of the
    # season, the two that the old lines hold among them.
    api.scores = {NBA: scores(TUESDAY + WEDNESDAY)}
    result = run(now=THURSDAY_MORNING)

    assert (result.status, result.asked) == (0, ["scores", "odds"])
    assert (result.outputs["results"], result.outputs["models"]) == ("2", "ok")
    assert (data_dir / OCTOBER).read_text().startswith(old_lines)
    lines = results_in(data_dir)
    assert [len(line) for line in lines] == [9, 9, 13, 13]
    # Nothing was frozen on Wednesday morning, so neither model is graded for its games.
    assert [(line["elo"], line["elo_verdict"]) for line in lines[2:]] == [(None, "not_graded")] * 2
    built = read(data_dir, "v1/record.json")
    assert (built["games"], built["market"]["games"]) == (4, 4)
    assert (built["elo"]["not_graded"], built["points_rest"]["not_graded"]) == (4, 4)
    rebuilt = read(data_dir, "v1/model.json")
    assert (rebuilt["status"], rebuilt["games"]) == ("ok", 4)
    assert rebuilt["results_through"] == "2026-10-21"
    # Boston lost on Tuesday, which an old line says, and on Wednesday.
    assert rebuilt["teams"]["BOS"] == {"wins": 0, "losses": 2}
    ratings = rebuilt["elo"]["ratings"]
    assert (ratings["NYK"]["rating"], ratings["GSW"]["rating"]) == (1727, 1479)
    assert read(data_dir, "v1/slate.json")["record"]["elo"] == {"wins": 0, "losses": 0}


@pytest.mark.usefixtures("tuesday_played")
def test_a_fault_in_the_models_does_not_cost_the_results_of_the_night(
    run, data_dir, tmp_path, monkeypatch
):
    def build_that_breaks(*args, **kwargs):
        raise RuntimeError("a bug in the models")

    monkeypatch.setattr(forecasts, "build", build_that_breaks)
    before = tree(data_dir)

    # The command ends with a traceback, as a program with a bug does.
    with pytest.raises(RuntimeError, match="a bug in the models"):
        run(now=WEDNESDAY_MORNING)

    # Before it did, it recorded the results, graded them for the sportsbooks
    # and for the models, and took the snapshot.
    assert [line["elo_verdict"] for line in results_in(data_dir)] == ["favorite_won", "upset"]
    assert read(data_dir, "v1/record.json")["elo"]["wins"] == 1
    state = read(data_dir, "v1/state.json")
    assert state["last_slot"] == state["results"]["last_slot"] == WEDNESDAY_SLOT
    # The models are as Tuesday's run left them, and nothing was frozen for Wednesday.
    assert tree(data_dir)["v1/model.json"] == before["v1/model.json"]
    assert not (data_dir / WEDNESDAYS_FORECASTS).exists()
    assert state["models"] == json.loads(before["v1/state.json"])["models"]
    written = (tmp_path / "github_output").read_text().splitlines()
    assert written[0] == "changed=true"
    assert "failed=basketball_nba" in written
    assert not any(line.startswith(("models=", "forecasts=")) for line in written)


@pytest.mark.usefixtures("tuesday_played")
def test_models_that_do_not_pass_their_checks_are_not_written_and_the_results_are(
    run, data_dir, monkeypatch
):
    # A bug in the model file: Detroit, which has not played, is given a win.
    counted = forecasts._wins_and_losses

    def with_a_win_too_many(played):
        table = counted(played)
        table["DET"]["wins"] += 1
        return table

    monkeypatch.setattr(forecasts, "_wins_and_losses", with_a_win_too_many)
    before = tree(data_dir)

    result = run(now=WEDNESDAY_MORNING)

    assert (result.status, result.asked) == (2, ["scores", "odds"])
    complaints = result.err.splitlines()
    assert complaints[0] == "Validation failed for the models of basketball_nba:"
    assert complaints[1].startswith("  model: teams is {")
    assert complaints[2:] == ["The models for basketball_nba were not built."]
    assert result.out.splitlines()[1:3] == [
        "basketball_nba -> v1/: 2 results, 0 not graded, 0 dropped. "
        "Credits: 493 remaining, 7 used, 2 spent on this call.",
        f"Wrote {OCTOBER}, v1/record.json, v1/state.json.",
    ]
    assert (result.outputs["changed"], result.outputs["failed"]) == ("true", "basketball_nba")
    assert result.outputs["written"] == "v1 2 results and 2 games"
    assert "models" not in result.outputs
    assert len(results_in(data_dir)) == 2
    assert tree(data_dir)["v1/model.json"] == before["v1/model.json"]
    assert not (data_dir / WEDNESDAYS_FORECASTS).exists()
    # The daily work is on record, so the next trigger does not ask for the scores again.
    assert run(now=WEDNESDAY_MORNING + timedelta(minutes=30)).asked == []


@pytest.mark.parametrize(
    ("content", "complaints"),
    [
        (
            b"not json",
            [
                "The forecasts in v1/predictions/ cannot be continued from:",
                f"  {TUESDAYS_FORECASTS}: not JSON",
            ],
        ),
        (
            b'{"schema": 2, "games": []}',
            [
                "The forecasts in v1/predictions/ cannot be continued from:",
                f"  {TUESDAYS_FORECASTS}: schema is 2, expected 1",
            ],
        ),
        (b"\xff\xfe", [f"{TUESDAYS_FORECASTS} is not UTF-8 text."]),
    ],
    ids=["not JSON", "not forecasts", "not text"],
)
@pytest.mark.usefixtures("tuesday_played")
def test_a_predictions_file_that_cannot_be_read_stops_the_daily_work_before_its_request(
    run, data_dir, content, complaints
):
    (data_dir / TUESDAYS_FORECASTS).write_bytes(content)

    result = run(now=WEDNESDAY_MORNING)

    # No credit is spent on scores that could not be graded. The snapshot is taken.
    assert (result.status, result.asked) == (2, ["odds"])
    found = result.err.splitlines()
    assert found[: len(complaints)] == complaints
    assert found[-1] == "The results for basketball_nba were not recorded."
    assert (data_dir / TUESDAYS_FORECASTS).read_bytes() == content
    assert not (data_dir / "v1/results").exists()
    assert read(data_dir, "v1/state.json")["last_slot"] == WEDNESDAY_SLOT


def test_opening_files_that_cannot_be_used_stop_the_run_before_any_request(
    run, data_dir, monkeypatch
):
    def load_that_fails(name):
        raise ValueError("the Elo file is for 2027-28 and the points-and-rest file is for 2026-27")

    monkeypatch.setattr(season, "load", load_that_fails)

    result = run(now=TUESDAY_MORNING)

    assert (result.status, result.asked) == (1, [])
    assert result.err.splitlines() == [
        "The opening files of season 2026_27 in pipeline/model/ cannot be used for "
        "basketball_nba: ValueError: the Elo file is for 2027-28 and "
        "the points-and-rest file is for 2026-27.",
        "Nothing was written.",
    ]
    assert not data_dir.exists()


def test_the_opening_files_are_read_before_any_sport_is_asked_for(
    api, data_dir, monkeypatch, capsys
):
    # Two sports. The first is not forecast, and the second is, from a
    # season that has no files.
    monkeypatch.setattr(
        config,
        "SPORTS",
        (
            config.Sport(key=PRESEASON, prefix="v1-test"),
            config.Sport(key=NBA, prefix="v1", season="1999_00"),
        ),
    )
    monkeypatch.setenv("ODDS_API_KEY", KEY)
    monkeypatch.setenv("ODDS_API_BASE_URL", api.url)
    api.events[PRESEASON] = odds(TUESDAY)

    status = main(["snapshot", "--all", "--data-dir", str(data_dir)], clock=lambda: MONDAY_NIGHT)

    # Not even the sport that needs no files was asked for.
    assert (status, api.requests) == (1, [])
    assert capsys.readouterr().err.splitlines()[-1] == "Nothing was written."
    assert not data_dir.exists()


@pytest.mark.usefixtures("tuesday_played")
def test_a_record_that_miscounts_a_model_is_not_written(run, data_dir, monkeypatch):
    build = record.build

    def build_with_a_win_too_many_for_elo(lines, **options):
        built = build(lines, **options)
        built["elo"]["wins"] += 1
        return built

    monkeypatch.setattr(record, "build", build_with_a_win_too_many_for_elo)

    result = run(now=WEDNESDAY_MORNING)

    assert result.status == 2
    # The board would have carried the win too many as well.
    assert result.err.splitlines() == [
        "Validation failed for the results of basketball_nba:",
        "  record: elo.wins is 2, and a recount of the result lines gives 1",
        "  state results record: elo wins is 2, and a recount of the result lines gives 1",
        "The results for basketball_nba were not recorded.",
    ]
    assert not (data_dir / "v1/results").exists()
    assert read(data_dir, "v1/state.json")["results"]["last_slot"] == TUESDAY_SLOT


@pytest.mark.usefixtures("tuesday_played")
def test_a_board_record_that_miscounts_a_model_is_not_written(run, data_dir, monkeypatch):
    headline = record.headline

    def headline_with_the_models_the_wrong_way_round(built, models=()):
        noted = headline(built, models)
        noted["points_rest"] = {"wins": 0, "losses": 2}
        return noted

    monkeypatch.setattr(record, "headline", headline_with_the_models_the_wrong_way_round)

    result = run(now=WEDNESDAY_MORNING)

    assert result.status == 2
    assert result.err.splitlines() == [
        "Validation failed for the results of basketball_nba:",
        "  state results record: points_rest wins is 0, "
        "and a recount of the result lines gives 1",
        "  state results record: points_rest losses is 2, "
        "and a recount of the result lines gives 1",
        "The results for basketball_nba were not recorded.",
    ]
    assert not (data_dir / "v1/results").exists()


def test_forecasts_that_would_replace_the_file_of_the_day_are_refused(
    run, api, data_dir, monkeypatch
):
    run(now=MONDAY_NIGHT)
    # As in the test above: the forecasts are written, and the daily work is
    # not on record.
    replace, failed_once = os.replace, []

    def failing_once(source, destination):
        if Path(destination).name == "state.json" and not failed_once:
            failed_once.append(destination)
            raise OSError(errno.ENOSPC, "No space left on device")
        replace(source, destination)

    monkeypatch.setattr(store.os, "replace", failing_once)
    assert run(now=TUESDAY_MORNING).status == 1
    frozen = (data_dir / TUESDAYS_FORECASTS).read_bytes()
    # A bug in the builder: it makes the forecasts again although the day has its file.
    build = forecasts.build
    monkeypatch.setattr(
        forecasts, "build", lambda *args, **options: build(*args, **{**options, "frozen": None})
    )

    result = run(now=TUESDAY_MORNING + timedelta(minutes=30))

    assert result.status == 2
    assert result.err.splitlines() == [
        "Validation failed for the models of basketball_nba:",
        f"  {TUESDAYS_FORECASTS}: the file is there, "
        "and forecasts that are published never change",
        "The models for basketball_nba were not built.",
    ]
    assert (data_dir / TUESDAYS_FORECASTS).read_bytes() == frozen
    assert not (data_dir / "v1/model.json").read_text().count("09:40:07")


@pytest.mark.usefixtures("tuesday_played")
def test_a_note_for_the_board_that_does_not_pass_its_checks_is_not_written(
    run, data_dir, monkeypatch
):
    # A bug in what the state notes of the models: a rating with decimals.
    build = forecasts.build

    def build_with_a_rating_that_is_not_rounded(*args, **options):
        built = build(*args, **options)
        built.state["models"]["elo"]["BOS"] = 1600.2
        return built

    monkeypatch.setattr(forecasts, "build", build_with_a_rating_that_is_not_rounded)
    before = tree(data_dir)

    result = run(now=WEDNESDAY_MORNING)

    assert result.status == 2
    assert result.err.splitlines() == [
        "Validation failed for the models of basketball_nba:",
        "  state models: elo must give each of the 30 teams a whole-number rating",
        "The models for basketball_nba were not built.",
    ]
    assert len(results_in(data_dir)) == 2
    assert tree(data_dir)["v1/model.json"] == before["v1/model.json"]
    assert (
        read(data_dir, "v1/state.json")["models"] == json.loads(before["v1/state.json"])["models"]
    )


def test_a_board_whose_forecasts_do_not_pass_their_checks_is_not_written(
    first_morning, run, data_dir, monkeypatch
):
    # A bug in the board: Elo's chance comes out as a percentage.
    monkeypatch.setattr(
        snapshot, "_forecasts", lambda game, models, season: {"elo": {"p_home": 39.65}}
    )
    before = tree(data_dir)

    result = run(now=TUESDAY_MORNING + timedelta(hours=4))

    assert result.status == 2
    complaints = result.err.splitlines()
    assert complaints[0] == "Validation failed for basketball_nba:"
    assert (
        f"  slate game '{BOS_NYK.id}' elo: must be null or hold p_home, a number between 0 and 1"
        in complaints
    )
    assert f"  slate game '{BOS_NYK.id}' points_rest: must be null or a forecast" in complaints
    assert complaints[-1] == "Nothing was written."
    assert tree(data_dir) == before
