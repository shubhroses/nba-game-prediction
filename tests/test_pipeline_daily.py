"""
End-to-end tests for the daily work of `python -m pipeline snapshot`: in the
day's first slot the games that are over are recorded with their final
scores, graded against the lines that earlier snapshots stored, and the
record is rebuilt.

As in test_pipeline_cli.py the command runs against the fake server in
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
from pipeline import record, results, snapshot, store
from pipeline.__main__ import main

# A made-up value. It is deliberately not shaped like a real key.
KEY = "fake-key-not-a-real-one"
NBA = "basketball_nba"

# Tuesday 20 October 2026 in New York. The lines are taken at 18:10, the
# games are played that evening, and the day's first slot of Wednesday starts
# at 05:10, which is 09:10 UTC.
EVENING = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
MORNING = datetime(2026, 10, 21, 9, 10, 7, tzinfo=timezone.utc)
LINES_AT, RECORDED_AT = "2026-10-20T22:10:41Z", "2026-10-21T09:10:07Z"
EVENING_SLOT = "2026-10-20T18:10-04:00"
DAILY_SLOT, NEXT_SLOT = "2026-10-21T05:10-04:00", "2026-10-21T09:10-04:00"
OCTOBER = "v1/results/2026-10.ndjson"
# What is on disk when Tuesday evening's and Wednesday morning's snapshots have
# been taken and no daily work has been recorded.
FILES_OF_THE_SNAPSHOTS = [
    "v1/history/2026-10-20.ndjson",
    "v1/history/2026-10-21.ndjson",
    "v1/slate.json",
    "v1/state.json",
]


@dataclass(frozen=True)
class Game:
    id: str
    home: str
    away: str
    start: str
    home_share: float | None  # the line at 18:10, or None when no sportsbook quoted the game
    points: tuple | None  # the final score, or None when the game is not over


# Five games on Tuesday evening and one on Wednesday. With these lines and
# scores: Boston was the favorite at 0.532 and won. Miami at 0.505 was no
# favorite. Denver at 0.7 lost, which is an upset. Utah's game had no line.
# Golden State was the favorite at 0.75, as the away team, and won.
BOS_NYK = Game(
    "1" * 32, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", 0.532, (112, 104)
)
MIA_CHI = Game("2" * 32, "Miami Heat", "Chicago Bulls", "2026-10-20T23:30:00Z", 0.505, (97, 95))
DEN_DAL = Game(
    "3" * 32, "Denver Nuggets", "Dallas Mavericks", "2026-10-21T01:00:00Z", 0.7, (101, 110)
)
UTA_PHX = Game("4" * 32, "Utah Jazz", "Phoenix Suns", "2026-10-21T01:30:00Z", None, (120, 110))
LAL_GSW = Game(
    "5" * 32, "Los Angeles Lakers", "Golden State Warriors", "2026-10-21T02:00:00Z", 0.25, (99, 120)
)
HOU_SAS = Game(
    "6" * 32, "Houston Rockets", "San Antonio Spurs", "2026-10-22T00:00:00Z", 0.6, (88, 93)
)
TUESDAY = [BOS_NYK, MIA_CHI, DEN_DAL, UTA_PHX, LAL_GSW]
VERDICTS = ["favorite_won", "toss_up", "upset", "not_graded", "favorite_won"]


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


def scores(over, not_over=()):
    """The games as the scores list them: some completed, the others without a score yet."""
    listed = [score_event(game.id, game.home, game.away, game.start, game.points) for game in over]
    listed += [
        score_event(game.id, game.home, game.away, game.start, None, completed=False)
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
    with FakeOddsApi({NBA: odds([*TUESDAY, HOU_SAS])}) as fake:
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

    def run(*options, now=None, clock=None):
        github_output.write_text("")
        before = len(api.requests)
        status = main(
            ["snapshot", "--all", "--data-dir", str(data_dir), *options],
            clock=clock or (lambda: now),
        )
        printed = capsys.readouterr()
        written = github_output.read_text()
        for text in (printed.out, printed.err, written, *tree(data_dir).values()):
            assert KEY not in text
        outputs = dict(line.split("=", 1) for line in written.splitlines())
        asked = [received.endpoint for received in api.requests[before:]]
        return Result(status, printed.out, printed.err, outputs, asked)

    return run


@pytest.fixture
def lines_taken(run):
    """Tuesday's 18:10 snapshot has been taken: every game but Utah's has a line in the state."""
    assert run(now=EVENING).status == 0


@pytest.fixture
def played(api, lines_taken):
    """And Tuesday's games have been played. Wednesday's game is still to come."""
    api.scores = {NBA: scores(TUESDAY, not_over=[HOU_SAS])}


def tree(directory):
    """Every file under a directory, by relative path, with its content."""
    return {
        str(path.relative_to(directory)): path.read_text()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def read(directory, path):
    return json.loads((directory / path).read_text())


def results_in(directory, path=OCTOBER):
    return [json.loads(line) for line in (directory / path).read_text().splitlines()]


@pytest.mark.usefixtures("played")
def test_the_daily_run_records_the_results_and_then_takes_the_snapshot(run, api, data_dir):
    result = run(now=MORNING)

    assert result.status == 0
    assert result.err == ""
    # The scores are asked for first, with the key and three days back.
    assert result.asked == ["scores", "odds"]
    assert api.requests[-2].query == {"apiKey": KEY, "daysFrom": "3"}
    assert result.out.splitlines() == [
        f"Slot {DAILY_SLOT}. The next slot starts at {NEXT_SLOT}.",
        "basketball_nba -> v1/: 5 results, 1 not graded, 0 dropped. "
        "Credits: 497 remaining, 3 used, 2 spent on this call.",
        "Wrote v1/results/2026-10.ndjson, v1/record.json, v1/state.json.",
        "basketball_nba -> v1/: 1 game, 1 with a line, 0 dropped. "
        "Credits: 496 remaining, 4 used, 1 spent on this call.",
        "Wrote v1/history/2026-10-21.ndjson, v1/slate.json, v1/state.json.",
    ]
    assert result.outputs == {
        "changed": "true",
        "slot": DAILY_SLOT,
        "results": "5",
        "results_not_graded": "1",
        "results_dropped": "0",
        "games": "1",
        "with_line": "1",
        "dropped": "0",
        "credits_remaining": "496",
        "credits_used": "4",
        "credits_spent": "3",
        "written": "v1 5 results and 1 game",
    }
    assert sorted(tree(data_dir)) == [
        "v1/history/2026-10-20.ndjson",
        "v1/history/2026-10-21.ndjson",
        "v1/record.json",
        "v1/results/2026-10.ndjson",
        "v1/slate.json",
        "v1/state.json",
    ]


@pytest.mark.usefixtures("played")
def test_each_game_that_is_over_gets_one_line_with_its_score_its_line_and_the_verdict(
    run, data_dir
):
    run(now=MORNING)

    written = (data_dir / OCTOBER).read_text()
    assert written.splitlines()[0] == (
        f'{{"id":"{BOS_NYK.id}","commence_time":"2026-10-20T23:00:00Z","home":"BOS","away":"NYK",'
        f'"home_pts":112,"away_pts":104,"recorded_at":"{RECORDED_AT}",'
        f'"market":{{"p_home":0.532,"lo":0.532,"hi":0.532,"n":1,"at":"{LINES_AT}"}},'
        '"market_verdict":"favorite_won"}'
    )
    lines = results_in(data_dir)
    # In order of start.
    assert [line["id"] for line in lines] == [game.id for game in TUESDAY]
    assert [(line["home_pts"], line["away_pts"]) for line in lines] == [
        game.points for game in TUESDAY
    ]
    assert [line["market"] and line["market"]["p_home"] for line in lines] == [
        game.home_share for game in TUESDAY
    ]
    assert [line["market_verdict"] for line in lines] == VERDICTS
    # Wednesday's game is not over and has no line in the file.
    assert HOU_SAS.id not in written


@pytest.mark.usefixtures("played")
def test_the_record_is_built_from_the_lines(run, data_dir):
    run(now=MORNING)

    built = read(data_dir, "v1/record.json")
    assert built == record.build(results_in(data_dir), sport=NBA)
    assert (built["since"], built["games"]) == ("2026-10-20", 5)
    market = built["market"]
    assert (market["games"], market["wins"], market["losses"]) == (3, 2, 1)
    assert (market["toss_ups"], market["not_graded"], market["with_line"]) == (1, 1, 4)
    # 2 of 3. The squared distances are 0.219024, 0.245025, 0.49 and 0.0625,
    # which add up to 1.016549, and a quarter of that is 0.25413725.
    assert (market["accuracy"], market["brier"]) == (0.6667, 0.2541)
    assert built["baseline_home"] == {"games": 5, "wins": 3}
    assert [upset["id"] for upset in market["biggest_upsets"]] == [DEN_DAL.id]
    # All five were played on Tuesday evening in New York, the last two after midnight UTC.
    assert built["by_day"] == [
        {
            "day": "2026-10-20",
            "games": 5,
            "market": {"wins": 2, "losses": 1, "toss_ups": 1, "not_graded": 1},
        }
    ]


@pytest.mark.usefixtures("played")
def test_the_state_notes_the_daily_work_and_the_board_shows_it(run, data_dir):
    run(now=MORNING)

    state, slate = read(data_dir, "v1/state.json"), read(data_dir, "v1/slate.json")
    assert state["last_slot"] == DAILY_SLOT
    assert state["results"] == {
        "last_slot": DAILY_SLOT,
        "last_run_at": RECORDED_AT,
        "record": {"market": {"wins": 2, "losses": 1}},
        "recent": results_in(data_dir),
    }
    # The credits are those of the last response, which was the odds.
    assert state["credits"] == {"remaining": 496, "used": 4, "last": 1}
    # The snapshot that followed in the same run put the record on the board.
    assert slate["record"] == {"market": {"wins": 2, "losses": 1}}
    assert slate["recent_results"] == results_in(data_dir)
    assert [game["id"] for game in slate["games"]] == [HOU_SAS.id]


@pytest.mark.usefixtures("played")
def test_files_from_before_there_was_any_daily_work_are_continued_from(run, data_dir):
    # The first snapshots on the data branch were written before the job did
    # any daily work. Their state has no `results`, and their board has
    # neither a record nor recent results.
    state, slate = read(data_dir, "v1/state.json"), read(data_dir, "v1/slate.json")
    del state["results"], slate["record"], slate["recent_results"]
    (data_dir / "v1/state.json").write_text(store.to_json(state))
    (data_dir / "v1/slate.json").write_text(store.to_json(slate))

    result = run(now=MORNING)

    # The lines that those snapshots stored are what the games are graded against.
    assert (result.status, result.asked) == (0, ["scores", "odds"])
    assert [line["market_verdict"] for line in results_in(data_dir)] == VERDICTS
    assert read(data_dir, "v1/state.json")["results"]["last_slot"] == DAILY_SLOT
    assert read(data_dir, "v1/slate.json")["record"] == {"market": {"wins": 2, "losses": 1}}


@pytest.mark.usefixtures("played")
def test_a_result_is_stamped_with_the_moment_its_scores_arrived(run, data_dir):
    # The clock is read when the run begins, when the scores are there and
    # when the odds are there. Here the scores took 90 seconds to arrive.
    begun = datetime(2026, 10, 21, 9, 10, 0, tzinfo=timezone.utc)
    readings = iter([begun, begun + timedelta(seconds=90), begun + timedelta(seconds=95)])

    result = run(clock=lambda: next(readings))

    assert result.status == 0
    assert {line["recorded_at"] for line in results_in(data_dir)} == {"2026-10-21T09:11:30Z"}
    assert read(data_dir, "v1/state.json")["results"]["last_run_at"] == "2026-10-21T09:11:30Z"
    assert read(data_dir, "v1/slate.json")["generated_at"] == "2026-10-21T09:11:35Z"


@pytest.mark.usefixtures("played")
def test_a_second_run_in_the_same_slot_asks_for_nothing_and_changes_nothing(run, data_dir):
    run(now=MORNING)
    after_the_first_run = tree(data_dir)

    # The next two triggers of the slot, and one long after them.
    for minutes in (30, 60, 180):
        result = run(now=MORNING + timedelta(minutes=minutes))

        assert (result.status, result.asked) == (0, [])
        assert result.out == (
            f"Not due: slot {DAILY_SLOT} is already recorded for basketball_nba. "
            f"The next slot starts at {NEXT_SLOT}.\n"
        )
        assert result.outputs == {"changed": "false", "slot": DAILY_SLOT}
        assert tree(data_dir) == after_the_first_run


@pytest.mark.usefixtures("played")
def test_the_scores_are_asked_for_in_the_first_slot_of_a_day_and_in_no_other(run, api, data_dir):
    run(now=MORNING)
    api.scores[NBA] = scores([*TUESDAY, HOU_SAS])

    # The five other slots of Wednesday, at 09:10, 12:10, 15:10, 18:10 and 21:10 in New York.
    for hours in (4, 7, 10, 13, 16):
        assert run(now=MORNING + timedelta(hours=hours)).asked == ["odds"]
    assert len(results_in(data_dir)) == 5

    # Thursday at 05:10.
    result = run(now=MORNING + timedelta(days=1))
    assert result.asked == ["scores", "odds"]
    assert result.outputs["results"] == "1"


def test_a_slot_that_is_not_the_days_first_does_not_ask_for_scores_that_were_never_recorded(run):
    # No daily work is on record, and 18:10 is not the slot for it.
    assert run(now=EVENING).asked == ["odds"]


@pytest.mark.usefixtures("played")
def test_the_next_mornings_run_adds_what_is_new_and_changes_no_line(run, api, data_dir):
    run(now=MORNING)
    first_lines = (data_dir / OCTOBER).read_text()
    # Thursday morning. Wednesday's game is over, and Tuesday's are still in the scores.
    api.scores[NBA] = scores([HOU_SAS, *reversed(TUESDAY)])

    result = run(now=MORNING + timedelta(days=1))

    assert (result.status, result.outputs["results"]) == (0, "1")
    assert result.outputs["written"] == "v1 1 result and 0 games"
    grown = (data_dir / OCTOBER).read_text()
    assert grown.startswith(first_lines)
    assert [line["id"] for line in results_in(data_dir)] == [
        *(game.id for game in TUESDAY),
        HOU_SAS.id,
    ]
    # Houston was the favorite at 0.6 and lost 88 to 93. It was played on Wednesday.
    built = read(data_dir, "v1/record.json")
    assert (built["market"]["wins"], built["market"]["losses"]) == (2, 2)
    assert [(day["day"], day["games"]) for day in built["by_day"]] == [
        ("2026-10-20", 5),
        ("2026-10-21", 1),
    ]
    assert read(data_dir, "v1/slate.json")["record"] == {"market": {"wins": 2, "losses": 2}}


@pytest.mark.usefixtures("played")
def test_the_same_scores_on_another_morning_change_neither_the_results_nor_the_record(
    run, data_dir
):
    run(now=MORNING)
    first = tree(data_dir)

    # Thursday's run gets the response that Wednesday's got.
    result = run(now=MORNING + timedelta(days=1))

    assert (result.status, result.asked) == (0, ["scores", "odds"])
    assert (result.outputs["results"], result.outputs["written"]) == (
        "0",
        "v1 0 results and 0 games",
    )
    assert result.out.splitlines()[1:3] == [
        "basketball_nba -> v1/: 0 results, 0 not graded, 0 dropped. "
        "Credits: 494 remaining, 6 used, 2 spent on this call.",
        "Wrote v1/record.json, v1/state.json.",
    ]
    second = tree(data_dir)
    assert second[OCTOBER] == first[OCTOBER]
    assert second["v1/record.json"] == first["v1/record.json"]
    assert read(data_dir, "v1/state.json")["results"]["last_slot"] == "2026-10-22T05:10-04:00"


@pytest.mark.usefixtures("lines_taken")
def test_two_daily_runs_that_were_missed_are_caught_up_from_one_response(run, api, data_dir):
    # The lines for Wednesday's game are taken on Wednesday at 18:10. Nothing
    # runs on Wednesday or Thursday morning. On Friday morning the scores
    # still reach back to Tuesday evening, three days less a few hours.
    run(now=EVENING + timedelta(days=1))
    api.scores[NBA] = scores([HOU_SAS, *TUESDAY])

    result = run(now=MORNING + timedelta(days=2))

    assert result.status == 0
    assert result.outputs["results"] == "6"
    assert [line["id"] for line in results_in(data_dir)] == [
        *(game.id for game in TUESDAY),
        HOU_SAS.id,
    ]
    assert [line["market_verdict"] for line in results_in(data_dir)] == [*VERDICTS, "upset"]
    built = read(data_dir, "v1/record.json")
    assert [(day["day"], day["games"]) for day in built["by_day"]] == [
        ("2026-10-20", 5),
        ("2026-10-21", 1),
    ]
    assert read(data_dir, "v1/state.json")["results"]["last_slot"] == "2026-10-23T05:10-04:00"


@pytest.mark.usefixtures("played")
def test_when_the_scores_fail_the_snapshot_is_still_taken_and_the_run_fails(run, api, data_dir):
    api.scores_status = 503

    result = run(now=MORNING)

    assert result.status == 4
    assert result.asked == ["scores", "odds"]
    assert result.err.splitlines() == [
        "The provider gave no usable answer to the scores request for basketball_nba: HTTP 503.",
        "The results for basketball_nba were not recorded.",
    ]
    assert result.out.splitlines() == [
        f"Slot {DAILY_SLOT}. The next slot starts at {NEXT_SLOT}.",
        "basketball_nba -> v1/: 1 game, 1 with a line, 0 dropped. "
        "Credits: 498 remaining, 2 used, 1 spent on this call.",
        "Wrote v1/history/2026-10-21.ndjson, v1/slate.json, v1/state.json.",
    ]
    assert result.outputs == {
        "changed": "true",
        "slot": DAILY_SLOT,
        "games": "1",
        "with_line": "1",
        "dropped": "0",
        "credits_remaining": "498",
        "credits_used": "2",
        "credits_spent": "1",
        "written": "v1 1 game",
        "failed": "basketball_nba",
    }
    state = read(data_dir, "v1/state.json")
    assert (state["last_slot"], state["results"]) == (DAILY_SLOT, None)
    assert not (data_dir / "v1/results").exists()
    assert not (data_dir / "v1/record.json").exists()


@pytest.mark.usefixtures("played")
def test_the_next_trigger_asks_for_the_scores_again_and_not_for_the_odds(run, api, data_dir):
    api.scores_status = 503
    run(now=MORNING)
    after_the_first_run = tree(data_dir)
    api.scores_status = None

    result = run(now=MORNING + timedelta(minutes=30))

    assert (result.status, result.asked) == (0, ["scores"])
    assert result.out.splitlines() == [
        f"Slot {DAILY_SLOT}. The next slot starts at {NEXT_SLOT}.",
        "basketball_nba -> v1/: 5 results, 1 not graded, 0 dropped. "
        "Credits: 496 remaining, 4 used, 2 spent on this call.",
        "Wrote v1/results/2026-10.ndjson, v1/record.json, v1/state.json.",
    ]
    assert result.outputs == {
        "changed": "true",
        "slot": DAILY_SLOT,
        "results": "5",
        "results_not_graded": "1",
        "results_dropped": "0",
        "credits_remaining": "496",
        "credits_used": "4",
        "credits_spent": "2",
        "written": "v1 5 results",
    }
    state = read(data_dir, "v1/state.json")
    assert state["results"]["last_slot"] == DAILY_SLOT
    assert state["credits"] == {"remaining": 496, "used": 4, "last": 2}
    # Nothing of the snapshot was touched. The board gets the record with the next snapshot.
    for path in ("v1/slate.json", "v1/history/2026-10-21.ndjson"):
        assert tree(data_dir)[path] == after_the_first_run[path]
    assert read(data_dir, "v1/slate.json")["record"] is None

    at_09_10 = run(now=MORNING + timedelta(hours=4))
    assert at_09_10.asked == ["odds"]
    assert read(data_dir, "v1/slate.json")["record"] == {"market": {"wins": 2, "losses": 1}}
    assert len(read(data_dir, "v1/slate.json")["recent_results"]) == 5


@pytest.mark.usefixtures("played")
def test_scores_that_fail_all_morning_are_asked_for_three_times_and_caught_up_the_next_day(
    run, api, data_dir
):
    api.scores_status = 429
    slot_start = datetime(2026, 10, 21, 9, 10, 0, tzinfo=timezone.utc)

    # Every trigger of the day's first slot, half an hour apart.
    morning = [run(now=slot_start + timedelta(minutes=30 * n)) for n in range(8)]

    assert [result.asked for result in morning] == [["scores", "odds"], ["scores"], ["scores"]] + [
        []
    ] * 5
    assert [result.status for result in morning] == [3, 3, 3, 0, 0, 0, 0, 0]
    assert morning[1].err.splitlines() == [
        "The provider refused the scores request for basketball_nba: HTTP 429.",
        "Nothing was written.",
    ]
    assert morning[1].outputs == {
        "changed": "false",
        "slot": DAILY_SLOT,
        "failed": "basketball_nba",
    }
    # From 75 minutes on the daily work of this slot is given up.
    for result in morning[3:]:
        assert result.out.splitlines() == [
            f"Not due: slot {DAILY_SLOT} is already recorded for basketball_nba. "
            f"The next slot starts at {NEXT_SLOT}.",
            f"The results that were due in slot {DAILY_SLOT} were not recorded in time for "
            "basketball_nba; the next daily run reaches back three days.",
        ]
        assert result.outputs == {
            "changed": "false",
            "slot": DAILY_SLOT,
            "results_given_up": "basketball_nba",
        }

    # The other slots of the day take their snapshots and leave the scores alone.
    rest_of_the_day = [run(now=slot_start + timedelta(hours=hours)) for hours in (4, 7, 10, 13, 16)]
    assert [result.asked for result in rest_of_the_day] == [["odds"]] * 5
    assert [result.status for result in rest_of_the_day] == [0] * 5
    assert not (data_dir / "v1/results").exists()

    # The provider answers again on Thursday morning, and Tuesday's games are still in reach.
    api.scores_status = None
    thursday = run(now=slot_start + timedelta(days=1))
    assert (thursday.status, thursday.asked) == (0, ["scores", "odds"])
    assert thursday.outputs["results"] == "5"


@pytest.mark.usefixtures("played")
def test_when_the_snapshot_fails_the_results_are_still_recorded_and_the_run_fails(
    run, api, data_dir
):
    api.status, api.scores_status = 503, 200

    result = run(now=MORNING)

    assert (result.status, result.asked) == (4, ["scores", "odds"])
    assert result.out.splitlines()[1:] == [
        "basketball_nba -> v1/: 5 results, 1 not graded, 0 dropped. "
        "Credits: 497 remaining, 3 used, 2 spent on this call.",
        "Wrote v1/results/2026-10.ndjson, v1/record.json, v1/state.json.",
    ]
    assert result.err.splitlines() == [
        "The provider gave no usable answer for basketball_nba: HTTP 503.",
        "The snapshot for basketball_nba was not taken.",
    ]
    assert (result.outputs["changed"], result.outputs["written"]) == ("true", "v1 5 results")
    assert result.outputs["failed"] == "basketball_nba"
    assert "games" not in result.outputs
    state = read(data_dir, "v1/state.json")
    assert (state["last_slot"], state["results"]["last_slot"]) == (EVENING_SLOT, DAILY_SLOT)

    # The next trigger asks for the odds only, and the board then shows the record.
    api.status = 200
    after = run(now=MORNING + timedelta(minutes=30))
    assert (after.status, after.asked, after.outputs["written"]) == (0, ["odds"], "v1 1 game")
    assert read(data_dir, "v1/slate.json")["record"] == {"market": {"wins": 2, "losses": 1}}


@pytest.mark.usefixtures("played")
def test_a_run_that_is_too_late_for_the_days_first_slot_gives_up_its_snapshot_and_its_results(
    run, data_dir
):
    after_the_evening = tree(data_dir)

    result = run(now=datetime(2026, 10, 21, 10, 25, 0, tzinfo=timezone.utc))

    assert (result.status, result.asked) == (0, [])
    assert result.out.splitlines() == [
        f"Slot {DAILY_SLOT} for basketball_nba was not recorded in time; "
        f"the next slot starts at {NEXT_SLOT}.",
        f"The results that were due in slot {DAILY_SLOT} were not recorded in time for "
        "basketball_nba; the next daily run reaches back three days.",
    ]
    assert result.outputs == {
        "changed": "false",
        "slot": DAILY_SLOT,
        "given_up": "basketball_nba",
        "results_given_up": "basketball_nba",
    }
    assert tree(data_dir) == after_the_evening

    # One second earlier it would have been in time for both.
    in_time = run(now=datetime(2026, 10, 21, 10, 24, 59, tzinfo=timezone.utc))
    assert in_time.asked == ["scores", "odds"]


@pytest.mark.usefixtures("played")
def test_force_does_daily_work_that_is_not_on_record_at_any_time_and_does_not_repeat_it(
    run, data_dir
):
    # 11:00 in New York on Wednesday, in the 09:10 slot. The morning's daily
    # work was never done.
    late_morning = datetime(2026, 10, 21, 15, 0, 0, tzinfo=timezone.utc)
    assert run(now=late_morning).asked == []

    forced = run("--force", now=late_morning)

    assert (forced.status, forced.asked) == (0, ["scores", "odds"])
    assert forced.outputs["written"] == "v1 5 results and 1 game"
    # It is noted as the work of the day's first slot, so that slot is not asked for again.
    state = read(data_dir, "v1/state.json")
    assert (state["last_slot"], state["results"]["last_slot"]) == (NEXT_SLOT, DAILY_SLOT)

    again = run("--force", now=late_morning + timedelta(minutes=5))
    assert (again.asked, again.outputs["written"]) == (["odds"], "v1 1 game")


@pytest.mark.usefixtures("played")
def test_a_dry_run_does_the_daily_work_and_writes_nothing(run, data_dir):
    after_the_evening = tree(data_dir)

    result = run("--dry-run", now=MORNING)

    assert (result.status, result.asked) == (0, ["scores", "odds"])
    assert result.out.splitlines() == [
        f"Slot {DAILY_SLOT}. The next slot starts at {NEXT_SLOT}.",
        "basketball_nba -> v1/: 5 results, 1 not graded, 0 dropped. "
        "Credits: 497 remaining, 3 used, 2 spent on this call.",
        "basketball_nba -> v1/: 1 game, 1 with a line, 0 dropped. "
        "Credits: 496 remaining, 4 used, 1 spent on this call.",
        "Dry run: nothing was written.",
    ]
    assert (result.outputs["changed"], result.outputs["results"]) == ("false", "5")
    assert "written" not in result.outputs
    assert tree(data_dir) == after_the_evening

    # Nothing was recorded, so both steps are still due.
    assert run(now=MORNING + timedelta(minutes=30)).asked == ["scores", "odds"]


@pytest.mark.usefixtures("lines_taken")
def test_a_completed_game_that_cannot_be_recorded_is_dropped_and_reported(run, api, data_dir):
    exhibition = score_event(
        "b" * 32, "Toronto Raptors", "Example Visitors", "2026-10-20T23:30:00Z", (110, 88)
    )
    without_scores = score_event(MIA_CHI.id, MIA_CHI.home, MIA_CHI.away, MIA_CHI.start, None)
    api.scores[NBA] = [exhibition, without_scores, *scores([BOS_NYK])]

    result = run(now=MORNING)

    assert result.status == 0
    assert result.out.splitlines()[1:4] == [
        "basketball_nba -> v1/: 1 result, 0 not graded, 2 dropped. "
        "Credits: 497 remaining, 3 used, 2 spent on this call.",
        f'  dropped event {"b" * 32}: unknown team "Example Visitors"',
        f"  dropped event {MIA_CHI.id}: completed without two usable scores: null",
    ]
    assert (result.outputs["results"], result.outputs["results_dropped"]) == ("1", "2")
    assert [line["id"] for line in results_in(data_dir)] == [BOS_NYK.id]
    assert all("b" * 32 not in content for content in tree(data_dir).values())


@pytest.mark.usefixtures("lines_taken")
def test_a_line_that_does_not_come_before_the_start_is_reported_and_its_game_not_graded(
    run, api, data_dir
):
    # The scores say that the game started at 22:00, ten minutes before its line was taken.
    api.scores[NBA] = [
        score_event(BOS_NYK.id, BOS_NYK.home, BOS_NYK.away, "2026-10-20T22:00:00Z", (112, 104))
    ]

    result = run(now=MORNING)

    assert result.status == 0
    assert result.out.splitlines()[1:3] == [
        "basketball_nba -> v1/: 1 result, 1 not graded, 0 dropped. "
        "Credits: 497 remaining, 3 used, 2 spent on this call.",
        f"  not graded event {BOS_NYK.id}: its line was captured at {LINES_AT}, "
        "which is not before the start at 2026-10-20T22:00:00Z",
    ]
    (line,) = results_in(data_dir)
    assert (line["market"], line["market_verdict"]) == (None, "not_graded")


@pytest.mark.usefixtures("lines_taken")
def test_the_results_of_two_months_go_into_two_files(run, api, data_dir):
    # Two games on the evening of Saturday 31 October in New York. The second
    # one starts at 20:30 there, which is 00:30 on 1 November in UTC.
    last_of_october = Game(
        "7" * 32, BOS_NYK.home, BOS_NYK.away, "2026-10-31T23:00:00Z", None, (101, 99)
    )
    first_of_november = Game(
        "8" * 32, MIA_CHI.home, MIA_CHI.away, "2026-11-01T00:30:00Z", None, (90, 96)
    )
    api.scores[NBA] = scores([first_of_november, last_of_october])

    # Sunday 1 November at 05:10 in New York, which is 10:10 UTC after the clocks went back.
    result = run(now=datetime(2026, 11, 1, 10, 10, 5, tzinfo=timezone.utc))

    assert result.status == 0
    assert (
        "Wrote v1/results/2026-10.ndjson, v1/results/2026-11.ndjson, v1/record.json" in result.out
    )
    assert [line["id"] for line in results_in(data_dir)] == ["7" * 32]
    assert [line["id"] for line in results_in(data_dir, "v1/results/2026-11.ndjson")] == ["8" * 32]
    # Both belong to the same day in New York.
    assert read(data_dir, "v1/record.json")["by_day"] == [
        {
            "day": "2026-10-31",
            "games": 2,
            "market": {"wins": 0, "losses": 0, "toss_ups": 0, "not_graded": 2},
        }
    ]


@pytest.mark.usefixtures("played")
def test_a_record_that_validation_refuses_is_not_written_and_the_snapshot_is_still_taken(
    run, data_dir, monkeypatch
):
    build = record.build

    def build_with_a_win_too_many(lines, **options):
        built = build(lines, **options)
        built["market"]["wins"] += 1
        return built

    monkeypatch.setattr(record, "build", build_with_a_win_too_many)

    result = run(now=MORNING)

    assert (result.status, result.asked) == (2, ["scores", "odds"])
    # The board would have carried the win too many as well.
    assert result.err.splitlines() == [
        "Validation failed for the results of basketball_nba:",
        "  record: market.wins is 3, and a recount of the result lines gives 2",
        "  state results record: wins is 3, and a recount of the result lines gives 2",
        "The results for basketball_nba were not recorded.",
    ]
    assert (result.outputs["changed"], result.outputs["failed"]) == ("true", "basketball_nba")
    assert sorted(tree(data_dir)) == FILES_OF_THE_SNAPSHOTS
    state = read(data_dir, "v1/state.json")
    assert (state["last_slot"], state["results"]) == (DAILY_SLOT, None)


@pytest.mark.usefixtures("played")
def test_result_lines_that_validation_refuses_are_not_written(run, data_dir, monkeypatch):
    # A bug in the builder: every game comes out as a draw.
    monkeypatch.setattr(results, "_points", lambda event, game_id: (100, 100))
    draw = (
        "home_pts and away_pts must be whole numbers that are not negative "
        "and not equal, got 100 and 100"
    )

    result = run(now=MORNING)

    # Each line is refused where it would be written: in the results file and in the state.
    assert result.status == 2
    assert result.err.splitlines() == [
        "Validation failed for the results of basketball_nba:",
        *(f"  {OCTOBER} line {number}: {draw}" for number in range(1, 6)),
        *(f"  state results recent '{game.id}': {draw}" for game in TUESDAY),
        "The results for basketball_nba were not recorded.",
    ]
    assert sorted(tree(data_dir)) == FILES_OF_THE_SNAPSHOTS


@pytest.mark.usefixtures("played")
def test_notes_for_the_state_that_validation_refuses_are_not_written(run, data_dir, monkeypatch):
    # A bug in what the state notes: its list of recent results ends with
    # something that is not a result.
    recent = snapshot.recent
    monkeypatch.setattr(snapshot, "recent", lambda lines, now: recent(lines, now) + [7])

    result = run(now=MORNING)

    assert result.status == 2
    assert result.err.splitlines() == [
        "Validation failed for the results of basketball_nba:",
        "  state results recent None: not a JSON object",
        "The results for basketball_nba were not recorded.",
    ]
    assert sorted(tree(data_dir)) == FILES_OF_THE_SNAPSHOTS


@pytest.mark.usefixtures("played")
def test_wins_and_losses_for_the_board_that_differ_from_a_recount_are_refused(
    run, data_dir, monkeypatch
):
    # A bug in what the state notes for the board: the wins and the losses change places.
    monkeypatch.setattr(
        record, "headline", lambda built, models=(): {"market": {"wins": 1, "losses": 2}}
    )

    result = run(now=MORNING)

    assert result.status == 2
    assert result.err.splitlines() == [
        "Validation failed for the results of basketball_nba:",
        "  state results record: wins is 1, and a recount of the result lines gives 2",
        "  state results record: losses is 2, and a recount of the result lines gives 1",
        "The results for basketball_nba were not recorded.",
    ]
    assert sorted(tree(data_dir)) == FILES_OF_THE_SNAPSHOTS


def no_space_left(monkeypatch, only_for):
    """Makes the move of a file into place fail when its path has the name given in it."""
    replace = os.replace

    def failing_replace(source, destination):
        if only_for in Path(destination).parts:
            raise OSError(errno.ENOSPC, "No space left on device")
        replace(source, destination)

    monkeypatch.setattr(store.os, "replace", failing_replace)


@pytest.mark.usefixtures("played")
def test_results_that_cannot_be_written_fail_the_run_and_the_snapshot_is_still_taken(
    run, data_dir, monkeypatch
):
    no_space_left(monkeypatch, only_for="results")

    result = run(now=MORNING)

    assert (result.status, result.asked) == (1, ["scores", "odds"])
    assert result.err.splitlines() == [
        "The results for basketball_nba could not be written: OSError: No space left on device.",
        "The results for basketball_nba were not recorded.",
    ]
    assert (result.outputs["written"], result.outputs["failed"]) == ("v1 1 game", "basketball_nba")
    assert sorted(tree(data_dir)) == FILES_OF_THE_SNAPSHOTS
    state = read(data_dir, "v1/state.json")
    assert (state["last_slot"], state["results"]) == (DAILY_SLOT, None)


@pytest.mark.usefixtures("played")
def test_lines_that_a_failed_write_left_behind_are_not_added_a_second_time(
    run, data_dir, monkeypatch
):
    # The results file is moved into place, and then the move of the state
    # file fails. The lines are there, and the daily work is not on record.
    with monkeypatch.context() as patched:
        no_space_left(patched, only_for="state.json")
        failed = run(now=MORNING)
    assert failed.status == 1
    left_behind = (data_dir / OCTOBER).read_text()
    assert len(left_behind.splitlines()) == 5
    assert read(data_dir, "v1/state.json")["results"] is None

    result = run(now=MORNING + timedelta(minutes=30))

    # It asks again, finds every game recorded and adds none of them twice.
    assert (result.status, result.asked) == (0, ["scores", "odds"])
    assert result.outputs["results"] == "0"
    assert (data_dir / OCTOBER).read_text() == left_behind
    state = read(data_dir, "v1/state.json")
    assert state["results"]["record"] == {"market": {"wins": 2, "losses": 1}}
    assert [line["id"] for line in state["results"]["recent"]] == [game.id for game in TUESDAY]
    assert read(data_dir, "v1/slate.json")["record"] == {"market": {"wins": 2, "losses": 1}}


@pytest.mark.parametrize(
    ("content", "complaint"),
    [
        ("not json\n", f"  {OCTOBER} line 1: not JSON"),
        ('{"id":"x"}', f"  {OCTOBER}: the existing file does not end with a newline"),
    ],
)
@pytest.mark.usefixtures("played")
def test_results_on_disk_that_cannot_be_added_to_stop_the_daily_work_before_its_request(
    run, data_dir, content, complaint
):
    (data_dir / "v1/results").mkdir()
    (data_dir / OCTOBER).write_text(content)

    result = run(now=MORNING)

    # No credit is spent on scores that could not be recorded. The snapshot is taken.
    assert (result.status, result.asked) == (2, ["odds"])
    assert result.err.splitlines() == [
        "The results in v1/results/ cannot be added to:",
        complaint,
        "The results for basketball_nba were not recorded.",
    ]
    assert (data_dir / OCTOBER).read_text() == content
    assert read(data_dir, "v1/state.json")["last_slot"] == DAILY_SLOT


@pytest.mark.usefixtures("played")
def test_an_error_nobody_foresaw_in_the_daily_work_does_not_cost_the_snapshot(
    run, data_dir, tmp_path, monkeypatch
):
    def build_that_breaks(*args, **kwargs):
        raise RuntimeError("a bug")

    monkeypatch.setattr(results, "build", build_that_breaks)

    # The command ends with a traceback, as a program with a bug does.
    with pytest.raises(RuntimeError, match="a bug"):
        run(now=MORNING)

    # Before it did, it took the snapshot, which could not have been taken
    # later, and it reported what it wrote, so that the workflow pushes it.
    assert read(data_dir, "v1/state.json")["last_slot"] == DAILY_SLOT
    assert (data_dir / "v1/history/2026-10-21.ndjson").exists()
    written = (tmp_path / "github_output").read_text().splitlines()
    assert written[:3] == ["changed=true", f"slot={DAILY_SLOT}", "games=1"]
    assert "failed=basketball_nba" in written
