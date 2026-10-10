"""
Tests for pipeline/model/season.py and for the two opening files of 2026-27:
the day a game belongs to, the games on a neutral floor, and what the files
hold.
"""

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline import teams
from pipeline.model import season

MODEL_DIRECTORY = Path(season.__file__).parent
ELO_FILE = MODEL_DIRECTORY / "elo_2026_27.json"
POINTS_REST_FILE = MODEL_DIRECTORY / "points_rest_2026_27.json"


def utc(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


@pytest.fixture
def opening():
    return season.load("2026_27")


def test_one_evenings_games_share_a_day_wherever_they_tip_off():
    # Tuesday 20 October 2026: an afternoon game in Europe at 19:00 UTC, the
    # first game of the evening at 19:00 in New York and the last at 22:30
    # there, which is 02:30 UTC on Wednesday.
    for start in ("2026-10-20 19:00", "2026-10-20 23:00", "2026-10-21 02:30"):
        assert season.game_day(utc(start)) == date(2026, 10, 20)

    # After the clocks go back in New York, 22:30 there is 03:30 UTC.
    assert season.game_day(utc("2026-11-03 03:30")) == date(2026, 11, 2)


def test_a_day_begins_ten_hours_after_midnight_utc():
    assert season.game_day(utc("2026-10-21 09:59")) == date(2026, 10, 20)
    assert season.game_day(utc("2026-10-21 10:00")) == date(2026, 10, 21)


def test_the_day_is_the_same_for_a_start_given_in_another_time_zone():
    new_york = timezone(timedelta(hours=-4))
    start = datetime(2026, 10, 20, 22, 30, tzinfo=new_york)

    assert season.game_day(start) == date(2026, 10, 20)
    with pytest.raises(ValueError, match="time zone"):
        season.game_day(datetime(2026, 10, 20, 22, 30))


def test_the_two_files_are_for_one_season_that_starts_on_20_october(opening):
    assert opening.name == "2026-27"
    assert opening.first_day == date(2026, 10, 20)
    assert opening.elo["season"] == opening.points_rest["season"] == "2026-27"


def test_the_elo_file_gives_30_whole_numbers_that_add_up_to_45149(opening):
    ratings = opening.elo["ratings"]

    assert set(ratings) == teams.ALL_CODES
    assert len(ratings) == 30
    assert all(type(rating) is int for rating in ratings.values())
    # 30 teams at the mean of 1505 would add up to 45,150. FiveThirtyEight's
    # last ratings added up to 45,148.6, and the sum of the unrounded opening
    # ratings is 45,149.56.
    assert sum(ratings.values()) == 45149
    assert (ratings["NYK"], ratings["SAS"], ratings["OKC"]) == (1720, 1702, 1684)
    # The three highest and the lowest.
    in_order = sorted(ratings, key=ratings.get, reverse=True)
    assert (in_order[:3], in_order[-1], ratings["WAS"]) == (["NYK", "SAS", "OKC"], "WAS", 1289)


def test_the_elo_file_gives_the_constants_and_says_where_the_ratings_come_from(opening):
    assert opening.elo["constants"] == {"k": 20, "home_court": 40, "mean": 1505, "reversion": 0.25}
    provenance = " ".join(opening.elo["provenance"])
    assert "FiveThirtyEight" in provenance
    assert "Creative Commons Attribution 4.0 International License (CC BY 4.0)" in provenance


def test_the_points_and_rest_file_holds_a_state_and_an_altitude_for_each_of_the_30_teams(opening):
    parameters = opening.points_rest

    assert set(parameters["state"]["teams"]) == set(teams.CODES)
    assert set(parameters["arena_altitude_km"]) == set(teams.CODES)
    assert set(parameters["coef"]) == {
        "home",
        "b2b_home",
        "b2b_away",
        "games7_diff",
        "altitude_km",
        "playoff_home",
    }
    assert all(team["var"] > 0 for team in parameters["state"]["teams"].values())
    # Denver's and Utah's arenas are the two above a kilometre.
    high = {name for name, km in parameters["arena_altitude_km"].items() if km > 1}
    assert high == {"Denver Nuggets", "Utah Jazz"}


def test_each_file_is_identified_by_the_sha_256_of_its_bytes(opening):
    assert opening.parameters == {
        "elo": hashlib.sha256(ELO_FILE.read_bytes()).hexdigest(),
        "points_rest": hashlib.sha256(POINTS_REST_FILE.read_bytes()).hexdigest(),
    }
    assert all(len(identifier) == 64 for identifier in opening.parameters.values())
    assert opening.elo == json.loads(ELO_FILE.read_text())
    assert opening.points_rest == json.loads(POINTS_REST_FILE.read_text())


def test_a_game_on_the_list_is_on_a_neutral_floor_whichever_team_is_called_home(opening):
    # Denver and Indiana in Mexico City, 7 November 2026, at 18:00 in New York.
    start = utc("2026-11-07 22:00")

    assert opening.game(start, "IND", "DEN") == season.Game(date(2026, 11, 7), "IND", "DEN", True)
    assert opening.game(start, "DEN", "IND").neutral
    # The same two teams on another day, and another visitor on the same day.
    assert not opening.game(start + timedelta(days=1), "IND", "DEN").neutral
    assert not opening.game(start, "IND", "BOS").neutral


def test_the_list_of_neutral_floors_is_matched_by_the_day_of_the_game(opening):
    # San Antonio and New Orleans in Paris on 14 January 2027. A start after
    # midnight UTC still belongs to that day.
    assert opening.game(utc("2027-01-14 19:00"), "SAS", "NOP").neutral
    assert opening.game(utc("2027-01-15 02:00"), "SAS", "NOP").neutral
    assert not opening.game(utc("2027-01-15 19:00"), "SAS", "NOP").neutral
    assert len(opening.neutral_floors) == len(opening.points_rest["neutral_games"]) == 3


def test_a_finished_game_carries_its_day_its_floor_and_its_score(opening):
    final = opening.final(utc("2026-11-07 22:00"), "IND", "DEN", 100, 131)

    assert final == season.Final(date(2026, 11, 7), "IND", "DEN", True, 100, 131)
    assert isinstance(final, season.Game)


def test_a_team_name_that_is_not_one_of_the_30_is_refused():
    assert season.code_of("Los Angeles Clippers") == "LAC"
    for name in ("LA Clippers", "LAC", None):
        with pytest.raises(ValueError, match="not one of the 30 team names"):
            season.code_of(name)


def test_a_season_without_files_cannot_be_loaded():
    with pytest.raises(FileNotFoundError):
        season.load("1999_00")


def write_files(directory, elo, points_rest):
    (directory / "elo_test.json").write_text(json.dumps(elo))
    (directory / "points_rest_test.json").write_text(json.dumps(points_rest))


@pytest.fixture
def files_in(tmp_path, monkeypatch, opening):
    """Lets a test load opening files of its own, named `test`, from a temporary directory."""
    monkeypatch.setattr(season, "_FILES", tmp_path)
    season.load.cache_clear()
    yield lambda elo, points_rest: write_files(tmp_path, elo, points_rest)
    season.load.cache_clear()


def test_files_for_two_different_seasons_are_refused(files_in, opening):
    files_in({**opening.elo, "season": "2027-28"}, opening.points_rest)

    with pytest.raises(ValueError, match="the Elo file is for 2027-28 and .* for 2026-27"):
        season.load("test")


@pytest.mark.parametrize(
    "change",
    [
        lambda ratings: ratings.pop("WAS"),
        lambda ratings: ratings.update(SEA=1500),
        lambda ratings: ratings.update(WAS=1288.8),
    ],
    ids=["a team is missing", "a team too many", "a rating with decimals"],
)
def test_an_elo_file_without_a_whole_number_for_each_of_the_30_teams_is_refused(
    files_in, opening, change
):
    ratings = dict(opening.elo["ratings"])
    change(ratings)
    files_in({**opening.elo, "ratings": ratings}, opening.points_rest)

    with pytest.raises(ValueError, match="each of the 30 teams a whole-number rating"):
        season.load("test")


def test_a_neutral_floor_for_a_team_that_is_not_one_of_the_30_is_refused(files_in, opening):
    listed = {"day": "2026-12-15", "home_team": "LA Clippers", "away_team": "Boston Celtics"}
    files_in(opening.elo, {**opening.points_rest, "neutral_games": [listed]})

    with pytest.raises(ValueError, match="'LA Clippers' is not one of the 30 team names"):
        season.load("test")
