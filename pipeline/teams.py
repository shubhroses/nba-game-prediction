"""
The 30 NBA teams: the name The Odds API uses for each, and its three-letter
code.

The names are the keys of the logo table in
nba-predictions-app/src/utils/formatters.ts. The codes are the NBA's own
(teamTricode in the league's scoreboard feed), which is what the dbt models
in nba_dbt/ carry, so a game recorded here can later be matched to its result.
"""

CODES = {
    "Atlanta Hawks": "ATL",
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA",
    "Chicago Bulls": "CHI",
    "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL",
    "Denver Nuggets": "DEN",
    "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW",
    "Houston Rockets": "HOU",
    "Indiana Pacers": "IND",
    "Los Angeles Clippers": "LAC",
    "Los Angeles Lakers": "LAL",
    "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA",
    "Milwaukee Bucks": "MIL",
    "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP",
    "New York Knicks": "NYK",
    "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL",
    "Philadelphia 76ers": "PHI",
    "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR",
    "Sacramento Kings": "SAC",
    "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR",
    "Utah Jazz": "UTA",
    "Washington Wizards": "WAS",
}

ALL_CODES = frozenset(CODES.values())


def code(name: object) -> str | None:
    """
    The code for a team name, or None when the name is not one of the 30.

    The match is exact. A name that is nearly right is not guessed at: the
    codes end up in a record that is graded later, and a wrong guess there is
    worse than a missing game.
    """
    return CODES.get(name) if isinstance(name, str) else None
