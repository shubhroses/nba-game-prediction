"""
The invented stretch of tests/sample_season.py, and the copy of its files in
nba-predictions-app/sample-data that the web app is built and looked at with
before the real season has a result.

The stretch is played once for all the tests here: 118 runs of the real
command against the fake server, which takes a few seconds. The first tests
hold the sample to it byte for byte, so a change to what the job writes
fails here until the sample is rebuilt:

    python -m tests.sample_season --sample-data

The others look for each state that the stretch is made to hold. They find
it in the files, as the page has to, and not in what the module set out to
do: the days, the teams and the times are written out here once more.
"""

import json
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

import sample_season
from pipeline import grading
from pipeline.model.season import game_day
from pipeline.record import day_of
from pipeline.timestamps import parse_utc

REPOSITORY = Path(__file__).resolve().parent.parent
SAMPLE = REPOSITORY / "nba-predictions-app" / "sample-data"
SAMPLE_FILES = [
    "v1/slate.json",
    "v1/record.json",
    "v1/model.json",
    "v1/predictions/2026-10-31.json",
    "v1/predictions/2026-11-01.json",
    "v1/predictions/2026-11-02.json",
    "v1/predictions/2026-11-03.json",
    "v1/predictions/2026-11-04.json",
    "v1/predictions/2026-11-05.json",
    "v1/predictions/2026-11-06.json",
    "v1/predictions/2026-11-07.json",
    "v1/predictions/2026-11-08.json",
]
REBUILD = "python -m tests.sample_season --sample-data"
MODELS = ("elo", "points_rest")
NOT_GRADED = "not_graded"


@pytest.fixture(scope="session")
def data_dir(tmp_path_factory):
    """The data directory that the stretch leaves, played once for the whole session."""
    directory = tmp_path_factory.mktemp("sample-season") / "data"
    sample_season.play(directory)
    return directory


def sample(path):
    return json.loads((SAMPLE / path).read_text())


@pytest.fixture
def slate():
    return sample("v1/slate.json")


@pytest.fixture
def record():
    return sample("v1/record.json")


@pytest.fixture
def model():
    return sample("v1/model.json")


@pytest.fixture
def saturday():
    """The forecasts of 7 November, whose games are over and graded."""
    return sample("v1/predictions/2026-11-07.json")


@pytest.fixture
def sunday():
    """The forecasts of 8 November, the day the stretch stops on."""
    return sample("v1/predictions/2026-11-08.json")


def tree(directory):
    """Every file under a directory, by relative path, with its bytes."""
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def results_in(directory):
    """Every result line of a data directory."""
    return [
        json.loads(line)
        for path in sorted((directory / "v1/results").glob("*.ndjson"))
        for line in path.read_text().splitlines()
    ]


def by_day(record):
    return {day["day"]: day for day in record["by_day"]}


def pick(p_home):
    """The side that a probability favors, "home" or "away". None when it favors neither."""
    favored = grading.favorite(p_home)
    return favored and favored[0]


def test_the_sample_is_byte_for_byte_what_the_stretch_leaves(data_dir):
    for path in SAMPLE_FILES:
        assert (SAMPLE / path).read_bytes() == (data_dir / path).read_bytes(), (
            f"{path} is not what the job writes now. Rebuild the sample: {REBUILD}"
        )


def test_the_sample_holds_the_files_the_page_reads_and_nothing_else_of_the_data_directory():
    held = [path for path in tree(SAMPLE) if not Path(path).name.startswith(".")]

    assert sorted(held) == sorted(["README.md", *SAMPLE_FILES])


def test_the_command_line_writes_the_same_bytes_in_another_process(data_dir, tmp_path):
    again = tmp_path / "data"

    done = subprocess.run(
        [sys.executable, "-m", "tests.sample_season", "--out", str(again)],
        cwd=REPOSITORY,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert done.returncode == 0, done.stderr
    first, second = tree(data_dir), tree(again)
    assert sorted(second) == sorted(first)
    assert [path for path in first if first[path] != second[path]] == []
    # The whole directory, of which the sample is the part that the page reads.
    assert {"v1/state.json", "v1/results/2026-10.ndjson", "v1/history/2026-11-08.ndjson"} < set(
        first
    )


def test_the_stretch_is_not_played_into_a_directory_that_holds_files(data_dir):
    before = tree(data_dir)

    with pytest.raises(ValueError, match="is not empty"):
        sample_season.play(data_dir)

    assert tree(data_dir) == before


def test_every_game_that_the_readme_names_is_in_the_sample():
    named = set(re.findall(r"\b[0-9a-f]{32}\b", (SAMPLE / "README.md").read_text()))
    held = "".join((SAMPLE / path).read_text() for path in SAMPLE_FILES)

    assert named
    assert [game_id for game_id in sorted(named) if game_id not in held] == []


def test_the_sportsbooks_have_invented_names_and_no_file_names_a_commit(slate, model):
    named = {book for game in slate["games"] if game["line"] for book in game["line"]["books"]}

    assert named == {f"Book {letter}" for letter in "ABCDEF"}
    # The job stamps its commit on the model file and on every predictions
    # file. The stretch is played without one.
    stamped = [model, *(sample(path) for path in SAMPLE_FILES if "/predictions/" in path)]
    assert len(stamped) == 10
    assert [document["code_commit"] for document in stamped] == [None] * 10


def test_the_sample_has_the_forecasts_of_every_day_that_the_page_or_its_tests_read(slate):
    # The page asks for the file of the day whose forecasts the board carries.
    # Its tests also read the file of the day of every result that carries a
    # forecast, and a view that asked for one of those days would be answered
    # with "no such file" if the file were not there.
    asked = {slate["models"]["predictions_day"]} | {
        game_day(parse_utc(line["commence_time"])).isoformat()
        for line in slate["recent_results"]
        if line["elo"]
    }

    assert sorted(asked) == [
        (date(2026, 10, 31) + timedelta(days=count)).isoformat() for count in range(9)
    ]
    assert sorted(path.stem for path in (SAMPLE / "v1/predictions").glob("*.json")) == sorted(asked)
    for day in asked:
        assert sample(f"v1/predictions/{day}.json")["day"] == day


def test_the_oldest_day_of_results_on_the_board_is_cut_by_the_eight_days_it_keeps(slate, record):
    # Saturday 31 October has afternoon games. By the last snapshot they
    # started more than eight days ago, and the evening games did not.
    forecast = sample("v1/predictions/2026-10-31.json")["games"]
    on_the_board = {line["id"] for line in slate["recent_results"]}
    dropped = [game for game in forecast if game["id"] not in on_the_board]

    assert by_day(record)["2026-10-31"]["games"] == len(forecast)
    assert 0 < len(dropped) < len(forecast)
    assert all(game["commence_time"] < "2026-10-31T23:10:00Z" for game in dropped)
    # Every later day is whole.
    recent = [day_of(line) for line in slate["recent_results"]]
    for day in record["by_day"]:
        if day["day"] > "2026-10-31":
            assert day["games"] == recent.count(day["day"])


def test_the_stretch_stops_with_the_1810_slot_of_sunday_8_november(slate, model, sunday):
    assert (slate["slot"], slate["next_due"]) == (
        "2026-11-08T18:10-05:00",
        "2026-11-08T21:10-05:00",
    )
    # The page is previewed with its clock at 23:30 UTC, after this snapshot.
    assert "2026-11-08T23:10:00Z" < slate["generated_at"] < "2026-11-08T23:30:00Z"
    assert slate["models"] == {
        "results_through": "2026-11-07",
        "status": "ok",
        "predictions_day": "2026-11-08",
    }
    # Both models are built again on the last day.
    assert (model["status"], model["reasons"], model["results_through"]) == ("ok", [], "2026-11-07")
    assert len(model["points_rest"]["ratings"]) == 30
    assert (sunday["status"], sunday["reasons"], sunday["day"]) == ("ok", [], "2026-11-08")


def test_the_record_has_120_games_and_an_interval_against_the_sportsbooks_for_each_model(record):
    assert record["since"] == "2026-10-20"
    assert record["games"] >= 120
    for name in MODELS:
        against = record[name]["brier_against_market"]
        assert against["games"] >= 30
        low, high = against["interval"]
        assert low <= against["difference"] <= high


def test_the_invented_games_are_ones_that_a_league_could_play(record, data_dir):
    lines = results_in(data_dir)

    # Ids like the provider's, and final scores like the NBA's. None is level.
    assert all(re.fullmatch(r"[0-9a-f]{32}", line["id"]) for line in lines)
    scores = [points for line in lines for points in (line["home_pts"], line["away_pts"])]
    assert 80 <= min(scores) and max(scores) <= 150
    assert all(line["home_pts"] != line["away_pts"] for line in lines)
    # Five to ten games on most days.
    assert sum(5 <= day["games"] <= 10 for day in record["by_day"]) >= 16
    # No team plays twice on a day or on three days running, and some play on two.
    played = {}
    for line in sorted(lines, key=day_of):
        for team in (line["home"], line["away"]):
            played.setdefault(team, []).append(date.fromisoformat(day_of(line)))
    assert len(played) == 30
    rests = [later - earlier for days in played.values() for earlier, later in zip(days, days[1:])]
    assert min(rests) == timedelta(days=1)
    assert 20 <= rests.count(timedelta(days=1)) <= 80
    assert not any(
        third - first == timedelta(days=2)
        for days in played.values()
        for first, third in zip(days, days[2:])
    )


def test_the_first_run_knew_no_game_so_opening_night_has_no_forecast(record, data_dir):
    opening_night = record["by_day"][0]

    assert opening_night["day"] == "2026-10-20"
    assert opening_night["games"] > 0
    for name in MODELS:
        assert opening_night[name]["not_graded"] == opening_night["games"]
    # Every later day has its forecasts, but for the morning that was missed.
    days = [date(2026, 10, 21) + timedelta(days=count) for count in range(19)]
    assert sorted(path.stem for path in (data_dir / "v1/predictions").glob("*.json")) == [
        day.isoformat() for day in days if day != date(2026, 10, 27)
    ]


def test_no_run_came_on_the_morning_of_27_october_and_the_next_one_made_up_for_it(record, data_dir):
    tuesday = by_day(record)["2026-10-27"]

    # The lines of the sportsbooks were taken all day. No model said anything that morning.
    assert tuesday["games"] > 0
    assert tuesday["market"]["not_graded"] == 0
    for name in MODELS:
        assert tuesday[name]["not_graded"] == tuesday["games"]
    assert not (data_dir / "v1/predictions/2026-10-27.json").exists()

    lines = results_in(data_dir)
    of_monday = [line for line in lines if day_of(line) == "2026-10-26"]
    of_tuesday = [line for line in lines if day_of(line) == "2026-10-27"]
    assert len(of_tuesday) == tuesday["games"]
    # Wednesday's run recorded both evenings. Monday's games were forecast on Monday.
    assert {line["recorded_at"][:10] for line in of_monday + of_tuesday} == {"2026-10-28"}
    assert all(line["elo"] and line["points_rest"] for line in of_monday)
    assert all(line["elo"] is None and line["points_rest"] is None for line in of_tuesday)


def test_a_score_is_missing_on_2_november_and_the_points_and_rest_model_is_left_out(
    slate, record, data_dir
):
    recent = slate["recent_results"]
    of_sunday = [line for line in recent if day_of(line) == "2026-11-01"]
    of_monday = [line for line in recent if day_of(line) == "2026-11-02"]

    # One game of 1 November is recorded on the 3rd, and the others on the 2nd.
    assert len(of_sunday) > 1
    (late,) = [line for line in of_sunday if not line["recorded_at"].startswith("2026-11-02")]
    assert late["recorded_at"].startswith("2026-11-03T10:10")
    # It is graded all the same: its line and its forecasts are from its own day.
    assert NOT_GRADED not in [late[f"{source}_verdict"] for source in ("market", *MODELS)]

    # The forecasts of 2 November say why they are Elo's alone.
    degraded = json.loads((data_dir / "v1/predictions/2026-11-02.json").read_text())
    assert degraded["status"] == "degraded"
    (reason,) = degraded["reasons"]
    assert reason.startswith("no result for ") and late["id"] in reason
    assert all(game["elo"] and game["points_rest"] is None for game in degraded["games"])
    # So the games of that day are graded for Elo and not for the other model.
    tally = by_day(record)["2026-11-02"]
    assert len(of_monday) == tally["games"] == len(degraded["games"])
    assert all(line["elo"] and line["points_rest"] is None for line in of_monday)
    assert tally["elo"]["not_graded"] == 0
    assert tally["points_rest"]["not_graded"] == tally["games"]
    # The day after, the score is there and both models are back.
    assert json.loads((data_dir / "v1/predictions/2026-11-03.json").read_text())["status"] == "ok"


def test_indiana_against_denver_on_7_november_is_on_a_neutral_floor(saturday, slate):
    (neutral,) = [game for game in saturday["games"] if game["neutral"]]

    assert (neutral["home"], neutral["away"]) == ("IND", "DEN")
    assert neutral["elo"]["home_court"] == 0
    assert neutral["points_rest"]["home_court"] == 0.0
    # Every other game of the day has a home team that is given something.
    others = [game for game in saturday["games"] if not game["neutral"]]
    assert all(game["elo"]["home_court"] == 40 for game in others)
    assert all(game["points_rest"]["home_court"] > 0 for game in others)
    # It is over, and its result is on the board.
    assert neutral["id"] in [line["id"] for line in slate["recent_results"]]


def test_one_game_was_never_quoted_by_a_sportsbook_and_is_not_graded_for_them(
    saturday, slate, record, data_dir
):
    (unquoted,) = [game for game in saturday["games"] if game["market"] is None]
    (result,) = [line for line in slate["recent_results"] if line["id"] == unquoted["id"]]

    assert (result["market"], result["market_verdict"]) == (None, NOT_GRADED)
    # Both models forecast it and are graded on it.
    assert NOT_GRADED not in [result[f"{name}_verdict"] for name in MODELS]
    assert record["market"]["not_graded"] == 1
    # It has a line in no snapshot.
    history = "".join(path.read_text() for path in (data_dir / "v1/history").glob("*.ndjson"))
    assert history and unquoted["id"] not in history


def test_several_lines_had_no_favorite_and_one_such_game_is_among_the_recent_results(record, slate):
    assert record["market"]["toss_ups"] >= 3
    assert "toss_up" in [line["market_verdict"] for line in slate["recent_results"]]


def test_favorites_of_the_sportsbooks_at_75_percent_or_more_have_lost(record):
    upsets = record["market"]["biggest_upsets"]

    assert len(upsets) == 3
    assert all(upset["p_favorite"] >= 0.75 for upset in upsets)
    # The biggest of them: Miami, at 88%, lost at home to Chicago.
    assert [upsets[0][key] for key in ("favorite", "home", "away", "home_pts", "away_pts")] == [
        "MIA",
        "MIA",
        "CHI",
        104,
        109,
    ]
    assert round(upsets[0]["p_favorite"], 2) == 0.88


def test_each_model_and_the_sportsbooks_picked_different_winners_in_three_games_or_more(record):
    for name in MODELS:
        picks = record[name]["picks_against_market"]
        assert picks["differ"] >= 3
        assert len(picks["latest"]) >= 3
        # The list has games of both kinds for the page to show.
        assert {game["right"] for game in picks["latest"]} == {"model", "market"}


def test_the_last_day_has_seven_games_with_frozen_forecasts_of_both_models(sunday, slate):
    games = sunday["games"]

    assert len(games) == 7
    assert sunday["published_at"].startswith("2026-11-08T10:10")
    assert all(game["elo"] and game["points_rest"] for game in games)
    assert all(game_day(parse_utc(game["commence_time"])) == date(2026, 11, 8) for game in games)

    # Two of them started before the last snapshot. They are not on the
    # board, and the scores are not asked for before the next morning.
    started = [game for game in games if game["commence_time"] <= slate["generated_at"]]
    assert [game["commence_time"] for game in started] == [
        "2026-11-08T20:30:00Z",
        "2026-11-08T23:00:00Z",
    ]
    on_the_board = {game["id"]: game for game in slate["games"]}
    over = [line["id"] for line in slate["recent_results"]]
    assert all(game["id"] not in on_the_board and game["id"] not in over for game in started)

    # Five start after it, and the board shows them with their frozen forecasts.
    to_come = [game for game in games if game["commence_time"] > slate["generated_at"]]
    assert [game["commence_time"] for game in to_come] == [
        "2026-11-09T00:10:00Z",
        "2026-11-09T00:40:00Z",
        "2026-11-09T01:40:00Z",
        "2026-11-09T02:10:00Z",
        "2026-11-09T03:40:00Z",
    ]
    assert [game["id"] for game in slate["games"][:5]] == [game["id"] for game in to_come]
    for game in to_come:
        shown = on_the_board[game["id"]]
        assert shown["elo"] == {"p_home": game["elo"]["p_home"]}
        assert shown["points_rest"] == game["points_rest"]
        assert shown["line"] is not None


def test_the_five_games_to_come_differ_in_what_the_sportsbooks_say_of_them(slate):
    to_come = [game for game in slate["games"] if game["points_rest"]]
    assert len(to_come) == 5

    # In one, the points-and-rest model and the sportsbooks pick different sides.
    (against,) = [
        game
        for game in to_come
        if {pick(game["points_rest"]["p_home"]), pick(game["line"]["p_home"])} == {"home", "away"}
    ]
    assert (against["home"], against["away"]) == ("CLE", "POR")
    # In one, the sportsbooks' line has no favorite.
    (even,) = [game for game in to_come if pick(game["line"]["p_home"]) is None]
    assert (even["home"], even["away"]) == ("TOR", "BOS")
    # One is quoted by a single sportsbook, which the board counts and does not name.
    (single,) = [game for game in to_come if game["line"]["n"] == 1]
    assert (single["home"], single["away"]) == ("MIN", "MEM")
    assert single["line"]["books"] == []
    assert single["line"]["lo"] == single["line"]["p_home"] == single["line"]["hi"]
    # In the other two the sportsbooks and both models pick the same side.
    for game in to_come:
        if game not in (against, even, single):
            sides = {pick(game[source]["p_home"]) for source in ("line", *MODELS)}
            assert len(sides) == 1 and None not in sides


def test_the_board_lists_the_three_days_after_with_elo_alone_and_some_without_a_line(slate):
    later = [game for game in slate["games"] if game["points_rest"] is None]

    assert len(later) == len(slate["games"]) - 5
    assert {game_day(parse_utc(game["commence_time"])) for game in later} == {
        date(2026, 11, 9),
        date(2026, 11, 10),
        date(2026, 11, 11),
    }
    assert all(0 < game["elo"]["p_home"] < 1 for game in later)
    without_a_line = [game for game in later if game["line"] is None]
    assert without_a_line
    assert all(game["open"] is None for game in without_a_line)
