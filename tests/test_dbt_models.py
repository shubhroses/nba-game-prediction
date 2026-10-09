"""
Builds the dbt project against fakesnow and checks the rows the models produce.

fakesnow is a local emulator. It speaks the Snowflake wire protocol, so the
real dbt-snowflake adapter connects to it, and it translates Snowflake SQL to
DuckDB. A pass here shows that dbt can build the project and that the SQL does
what is intended under DuckDB. It is not a test against Snowflake.

dbt is started through the flow's task function, so these tests also run the
command in data_transformation/transform_data.py for real.

The module is skipped when fakesnow is not installed (requirements-dev.txt).
"""

import copy
import itertools
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

import pytest
import snowflake.connector

import transform_data

fakesnow = pytest.importorskip("fakesnow")

REPO = Path(__file__).resolve().parents[1]

# The response saved in the output of notebooks/predict_past.ipynb: the three
# games of 12 December 2024, fetched in the morning before any had started.
MORNING = json.loads((Path(__file__).parent / "fixtures" / "scoreboard_20241212.json").read_text())

BOS_DET = "0022401205"
MIA_TOR = "0022401206"
NOP_SAC = "0022401207"
BOS, DET, MIA, TOR, NOP, SAC = (
    1610612738, 1610612765, 1610612748, 1610612761, 1610612740, 1610612758,
)
GAME_DATE = date(2024, 12, 12)
# meta.time of the saved response and of the made-up night response below.
MORNING_AT = datetime(2024, 12, 12, 6, 33, 12)
NIGHT_AT = datetime(2024, 12, 12, 22, 10, 44)

PROFILE = """
nba_dbt:
  target: emulator
  outputs:
    emulator:
      type: snowflake
      account: {account}
      user: {user}
      password: {password}
      host: {host}
      port: {port}
      protocol: {protocol}
      role: ANY_ROLE
      warehouse: ANY_WAREHOUSE
      database: {database}
      schema: ANALYTICS
      threads: 1
"""


def later_snapshot(time, results):
    """
    Returns a copy of the saved response as it could look later that day.
    'results' maps a game id to (gameStatus, gameStatusText, home score, away
    score). The statuses and scores passed in by the tests are made up.
    """
    response = copy.deepcopy(MORNING)
    response["meta"]["time"] = time
    for game in response["scoreboard"]["games"]:
        if game["gameId"] in results:
            status, status_text, home_score, away_score = results[game["gameId"]]
            game["gameStatus"] = status
            game["gameStatusText"] = status_text
            game["homeTeam"]["score"] = home_score
            game["awayTeam"]["score"] = away_score
    return response


# The first game is under way, the other two have not started.
EVENING = later_snapshot(
    "2024-12-12 19:55:02.5502",
    {BOS_DET: (2, "Q2 4:21", 48, 41)},
)
# One home win, one away win after overtime, one game still being played.
NIGHT = later_snapshot(
    "2024-12-12 22:10:44.1044",
    {
        BOS_DET: (3, "Final", 123, 99),
        MIA_TOR: (3, "Final/OT", 104, 114),
        NOP_SAC: (2, "Q4 2:05", 109, 111),
    },
)
# A day without games.
NO_GAMES = copy.deepcopy(MORNING)
NO_GAMES["meta"]["time"] = "2024-12-24 06:30:00.3000"
NO_GAMES["scoreboard"]["gameDate"] = "2024-12-24"
NO_GAMES["scoreboard"]["games"] = []


class Warehouse:
    """
    One database in the emulated Snowflake account, holding the raw table that
    the load script creates.
    """

    def __init__(self, settings, database):
        self.database = database
        self.connection = snowflake.connector.connect(**settings, database=database, schema="RAW")
        self.cursor = self.connection.cursor()
        # Same statement as create_table_if_not_exists() in move_nba_data_to_sf.py.
        self.cursor.execute("CREATE TABLE IF NOT EXISTS RAW_NBA_SCOREBOARD (game_data VARIANT)")

    def load(self, *responses):
        """Adds one row per response, which is what COPY INTO does with one JSON file."""
        for response in responses:
            self.cursor.execute(
                "INSERT INTO RAW_NBA_SCOREBOARD SELECT PARSE_JSON(%s)", (json.dumps(response),)
            )

    def rows(self, sql):
        self.cursor.execute(sql)
        return self.cursor.fetchall()

    def games(self):
        return self.rows(
            f"""
            select game_id, game_date, game_status_id, game_status_text, is_final,
                   home_team_id, home_team_tricode, home_score,
                   away_team_id, away_team_tricode, away_score, snapshot_at
            from {self.database}.ANALYTICS.stg_nba__games
            order by game_id
            """
        )

    def team_games(self):
        return self.rows(
            f"""
            select team_game_id, game_id, game_date, team_id, team_tricode,
                   opponent_team_id, opponent_team_tricode, home_away,
                   is_final, points_for, points_against, won
            from {self.database}.ANALYTICS.fct_team_games
            order by game_id, home_away desc
            """
        )

    def close(self):
        self.connection.close()


DATABASE_NUMBERS = itertools.count(1)


@pytest.fixture(scope="module")
def emulator():
    with fakesnow.server() as settings:
        yield settings


@pytest.fixture
def warehouse(emulator, tmp_path, monkeypatch):
    # Each test gets a database of its own in the shared emulator.
    database = f"NBA_{next(DATABASE_NUMBERS)}"
    (tmp_path / "profiles.yml").write_text(PROFILE.format(database=database, **emulator))
    monkeypatch.setenv("DBT_PROFILES_DIR", str(tmp_path))
    monkeypatch.setenv("DBT_PROJECT_DIR", str(REPO / "nba_dbt"))
    # Keep dbt's output out of the working tree.
    monkeypatch.setenv("DBT_TARGET_PATH", str(tmp_path / "target"))
    monkeypatch.setenv("DBT_LOG_PATH", str(tmp_path / "logs"))
    monkeypatch.setenv("DBT_SEND_ANONYMOUS_USAGE_STATS", "false")
    # The raw table lives where the load script would put it, which is not
    # the schema dbt builds into. The source has to find it there.
    monkeypatch.setenv("SNOWFLAKE_DATABASE", database)
    monkeypatch.setenv("SNOWFLAKE_SCHEMA", "RAW")
    # Find the dbt that is installed next to the running interpreter.
    monkeypatch.setenv(
        "PATH", os.pathsep.join([str(Path(sys.executable).parent), os.environ.get("PATH", "")])
    )
    account = Warehouse(emulator, database)
    yield account
    account.close()


def build_models():
    """Runs `dbt build` the way the transformation flow does."""
    transform_data.run_dbt_transformation.fn()


def test_models_follow_the_games_through_the_day(warehouse):
    # Morning: one response, nothing has started.
    warehouse.load(MORNING)
    build_models()

    assert warehouse.games() == [
        (BOS_DET, GAME_DATE, 1, "7:30 pm ET", False, BOS, "BOS", 0, DET, "DET", 0, MORNING_AT),
        (MIA_TOR, GAME_DATE, 1, "7:30 pm ET", False, MIA, "MIA", 0, TOR, "TOR", 0, MORNING_AT),
        (NOP_SAC, GAME_DATE, 1, "8:00 pm ET", False, NOP, "NOP", 0, SAC, "SAC", 0, MORNING_AT),
    ]
    assert warehouse.team_games() == [
        (f"{BOS_DET}-{BOS}", BOS_DET, GAME_DATE, BOS, "BOS", DET, "DET", "home", False, 0, 0, None),
        (f"{BOS_DET}-{DET}", BOS_DET, GAME_DATE, DET, "DET", BOS, "BOS", "away", False, 0, 0, None),
        (f"{MIA_TOR}-{MIA}", MIA_TOR, GAME_DATE, MIA, "MIA", TOR, "TOR", "home", False, 0, 0, None),
        (f"{MIA_TOR}-{TOR}", MIA_TOR, GAME_DATE, TOR, "TOR", MIA, "MIA", "away", False, 0, 0, None),
        (f"{NOP_SAC}-{NOP}", NOP_SAC, GAME_DATE, NOP, "NOP", SAC, "SAC", "home", False, 0, 0, None),
        (f"{NOP_SAC}-{SAC}", NOP_SAC, GAME_DATE, SAC, "SAC", NOP, "NOP", "away", False, 0, 0, None),
    ]

    # More responses arrive, not in the order they were fetched: the newest
    # first, the evening one twice, and the morning one again.
    warehouse.load(NIGHT, EVENING, EVENING, MORNING, NO_GAMES)
    build_models()

    # Still one row per game, each taken from the night response.
    assert warehouse.games() == [
        (BOS_DET, GAME_DATE, 3, "Final", True, BOS, "BOS", 123, DET, "DET", 99, NIGHT_AT),
        (MIA_TOR, GAME_DATE, 3, "Final/OT", True, MIA, "MIA", 104, TOR, "TOR", 114, NIGHT_AT),
        (NOP_SAC, GAME_DATE, 2, "Q4 2:05", False, NOP, "NOP", 109, SAC, "SAC", 111, NIGHT_AT),
    ]
    # A winner only where the game is finished: the home team in the first
    # game, the away team in the second, nobody yet in the third.
    assert warehouse.team_games() == [
        (f"{BOS_DET}-{BOS}", BOS_DET, GAME_DATE, BOS, "BOS", DET, "DET", "home", True, 123, 99, True),
        (f"{BOS_DET}-{DET}", BOS_DET, GAME_DATE, DET, "DET", BOS, "BOS", "away", True, 99, 123, False),
        (f"{MIA_TOR}-{MIA}", MIA_TOR, GAME_DATE, MIA, "MIA", TOR, "TOR", "home", True, 104, 114, False),
        (f"{MIA_TOR}-{TOR}", MIA_TOR, GAME_DATE, TOR, "TOR", MIA, "MIA", "away", True, 114, 104, True),
        (f"{NOP_SAC}-{NOP}", NOP_SAC, GAME_DATE, NOP, "NOP", SAC, "SAC", "home", False, 109, 111, None),
        (f"{NOP_SAC}-{SAC}", NOP_SAC, GAME_DATE, SAC, "SAC", NOP, "NOP", "away", False, 111, 109, None),
    ]


def test_newest_snapshot_is_kept_when_the_status_is_the_same(warehouse):
    # Two responses in which every game has the same status: the first two
    # games are being played and the third has not started.
    earlier = later_snapshot(
        "2024-12-12 20:05:11.0511",
        {BOS_DET: (2, "Q1 5:00", 20, 18), MIA_TOR: (2, "Q1 4:10", 15, 21)},
    )
    # The second status text ends in a space, which the model trims.
    later = later_snapshot(
        "2024-12-12 21:40:09.4009",
        {BOS_DET: (2, "Q4 6:30", 98, 90), MIA_TOR: (2, "Q4 5:55 ", 88, 97)},
    )
    later_at = datetime(2024, 12, 12, 21, 40, 9)
    # The earlier response is loaded both before and after the later one, so
    # the later one is neither the first nor the last row of the raw table.
    warehouse.load(earlier, later, earlier)
    build_models()

    assert warehouse.games() == [
        (BOS_DET, GAME_DATE, 2, "Q4 6:30", False, BOS, "BOS", 98, DET, "DET", 90, later_at),
        (MIA_TOR, GAME_DATE, 2, "Q4 5:55", False, MIA, "MIA", 88, TOR, "TOR", 97, later_at),
        (NOP_SAC, GAME_DATE, 1, "8:00 pm ET", False, NOP, "NOP", 0, SAC, "SAC", 0, later_at),
    ]
    # The mart has the later scores, and no winner because nothing is finished.
    assert warehouse.team_games() == [
        (f"{BOS_DET}-{BOS}", BOS_DET, GAME_DATE, BOS, "BOS", DET, "DET", "home", False, 98, 90, None),
        (f"{BOS_DET}-{DET}", BOS_DET, GAME_DATE, DET, "DET", BOS, "BOS", "away", False, 90, 98, None),
        (f"{MIA_TOR}-{MIA}", MIA_TOR, GAME_DATE, MIA, "MIA", TOR, "TOR", "home", False, 88, 97, None),
        (f"{MIA_TOR}-{TOR}", MIA_TOR, GAME_DATE, TOR, "TOR", MIA, "MIA", "away", False, 97, 88, None),
        (f"{NOP_SAC}-{NOP}", NOP_SAC, GAME_DATE, NOP, "NOP", SAC, "SAC", "home", False, 0, 0, None),
        (f"{NOP_SAC}-{SAC}", NOP_SAC, GAME_DATE, SAC, "SAC", NOP, "NOP", "away", False, 0, 0, None),
    ]


def test_status_is_compared_before_the_snapshot_time(warehouse):
    # meta.time has no time zone, so the model does not rely on it to order
    # two responses. Here the response in which the first game is final has
    # an earlier time than the one in which that game is still being played.
    final = later_snapshot("2024-12-12 22:10:44.1044", {BOS_DET: (3, "Final", 123, 99)})
    in_progress = later_snapshot("2024-12-12 23:15:20.1520", {BOS_DET: (2, "Q4 0:41", 119, 99)})
    final_at = datetime(2024, 12, 12, 22, 10, 44)
    in_progress_at = datetime(2024, 12, 12, 23, 15, 20)
    warehouse.load(final, in_progress)
    build_models()

    assert warehouse.games() == [
        # Kept from the final response although its time is the earlier one.
        (BOS_DET, GAME_DATE, 3, "Final", True, BOS, "BOS", 123, DET, "DET", 99, final_at),
        # Status 1 in both responses, so the later time decides.
        (MIA_TOR, GAME_DATE, 1, "7:30 pm ET", False, MIA, "MIA", 0, TOR, "TOR", 0, in_progress_at),
        (NOP_SAC, GAME_DATE, 1, "8:00 pm ET", False, NOP, "NOP", 0, SAC, "SAC", 0, in_progress_at),
    ]
    # The mart has the final score of the first game, and its winner.
    assert warehouse.team_games() == [
        (f"{BOS_DET}-{BOS}", BOS_DET, GAME_DATE, BOS, "BOS", DET, "DET", "home", True, 123, 99, True),
        (f"{BOS_DET}-{DET}", BOS_DET, GAME_DATE, DET, "DET", BOS, "BOS", "away", True, 99, 123, False),
        (f"{MIA_TOR}-{MIA}", MIA_TOR, GAME_DATE, MIA, "MIA", TOR, "TOR", "home", False, 0, 0, None),
        (f"{MIA_TOR}-{TOR}", MIA_TOR, GAME_DATE, TOR, "TOR", MIA, "MIA", "away", False, 0, 0, None),
        (f"{NOP_SAC}-{NOP}", NOP_SAC, GAME_DATE, NOP, "NOP", SAC, "SAC", "home", False, 0, 0, None),
        (f"{NOP_SAC}-{SAC}", NOP_SAC, GAME_DATE, SAC, "SAC", NOP, "NOP", "away", False, 0, 0, None),
    ]


def test_a_failing_schema_test_stops_the_flow_before_the_mart(warehouse):
    # A game without an id breaks the not_null test on stg_nba__games.game_id.
    broken = copy.deepcopy(MORNING)
    del broken["scoreboard"]["games"][0]["gameId"]
    warehouse.load(broken)

    with pytest.raises(SystemExit) as exit_info:
        build_models()

    assert exit_info.value.code == 1
    # The view was created before its test ran. The mart was never built.
    assert len(warehouse.games()) == 3
    with pytest.raises(snowflake.connector.errors.ProgrammingError):
        warehouse.team_games()
