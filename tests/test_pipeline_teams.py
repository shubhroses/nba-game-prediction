"""
Tests for pipeline/teams.py.

The table has to agree with two other things: the web app's logo table, whose
keys are the provider's spellings of the team names, and the NBA's own
three-letter codes, which are what the dbt models carry.
"""

import json
import re
from pathlib import Path

import pytest

from pipeline import teams

REPOSITORY = Path(__file__).resolve().parent.parent


def test_there_are_30_teams_and_30_different_codes():
    assert len(teams.CODES) == 30
    assert len(teams.ALL_CODES) == 30
    assert all(re.fullmatch(r"[A-Z]{3}", code) for code in teams.ALL_CODES)


def test_the_names_are_the_keys_of_the_web_apps_logo_table():
    source = (REPOSITORY / "nba-predictions-app/src/utils/formatters.ts").read_text()
    logo_table_keys = re.findall(r"'([^']+)': 'https://cdn\.nba\.com/logos/", source)

    assert len(logo_table_keys) == 30
    assert set(logo_table_keys) == set(teams.CODES)


def test_the_codes_are_the_ones_in_the_scoreboard_fixture():
    # The fixture is a response of the NBA's scoreboard feed, the source of
    # the team_tricode columns in nba_dbt/.
    scoreboard = json.loads((REPOSITORY / "tests/fixtures/scoreboard_20241212.json").read_text())
    checked = []
    for game in scoreboard["scoreboard"]["games"]:
        for team in (game["homeTeam"], game["awayTeam"]):
            assert teams.code(f"{team['teamCity']} {team['teamName']}") == team["teamTricode"]
            checked.append(team["teamTricode"])

    assert sorted(checked) == ["BOS", "DET", "MIA", "NOP", "SAC", "TOR"]


def test_every_code_is_the_abbreviation_nba_api_has_for_the_team():
    # nba_api ships the league's list of teams with the package, so this
    # needs no network. It is in requirements.txt, but the pipeline does not
    # use it, so the test is skipped where only pytest is installed. Teams are
    # matched by nickname ("Trail Blazers"), which both sources spell alike.
    static_teams = pytest.importorskip("nba_api.stats.static.teams")
    league = static_teams.get_teams()

    assert len(league) == 30
    for team in league:
        (name,) = [name for name in teams.CODES if name.endswith(" " + team["nickname"])]
        assert teams.CODES[name] == team["abbreviation"]


def test_only_an_exact_name_has_a_code():
    assert teams.code("Boston Celtics") == "BOS"
    assert teams.code("boston celtics") is None
    assert teams.code("Celtics") is None
    assert teams.code("LA Clippers") is None
    assert teams.code("") is None
    assert teams.code(None) is None
    assert teams.code(["Boston Celtics"]) is None
