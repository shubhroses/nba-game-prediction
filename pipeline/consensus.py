"""
The sportsbook consensus for one game.

Every sportsbook that quotes both teams gives one number: the home team's win
probability with that sportsbook's margin taken out. The consensus is the
median of those numbers.
"""

import math
import statistics
from dataclasses import dataclass

MARKET = "h2h"  # head to head: which team wins


@dataclass(frozen=True)
class Line:
    """The consensus for one game, before rounding."""

    p_home: float  # the median home share of the sportsbooks used
    lo: float  # the lowest home share
    hi: float  # the highest home share
    n: int  # how many sportsbooks were used
    books: tuple[str, ...]  # their titles, sorted


def home_share(price_home: float, price_away: float) -> float:
    """
    The home team's implied win probability with the sportsbook's margin removed.

    A decimal price p implies a probability of 1/p. The two implied
    probabilities of a game add up to more than 1, and the excess is the
    sportsbook's margin. Dividing the home side by the total removes it:

        (1/home) / (1/home + 1/away)  =  away / (home + away)

    processGames in nba-predictions-app/src/services/api.ts normalises the
    same way.
    """
    return price_away / (price_home + price_away)


def game_line(event: dict) -> Line | None:
    """
    The consensus for one event of an odds response.

    A sportsbook is used when its head-to-head market quotes both teams at a
    price above 1. Returns None when no sportsbook can be used. None means
    "no line"; it is never turned into a number such as 0, 0.5 or 1.
    """
    home, away = event.get("home_team"), event.get("away_team")
    quotes = []
    for bookmaker in _items(event.get("bookmakers")):
        title = bookmaker.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        market = next((m for m in _items(bookmaker.get("markets")) if m.get("key") == MARKET), None)
        if market is None:
            continue
        outcomes = _items(market.get("outcomes"))
        price_home, price_away = _price(outcomes, home), _price(outcomes, away)
        if price_home is not None and price_away is not None:
            quotes.append((title.strip(), home_share(price_home, price_away)))

    if not quotes:
        return None
    shares = [share for _, share in quotes]
    return Line(
        p_home=statistics.median(shares),
        lo=min(shares),
        hi=max(shares),
        n=len(shares),
        books=tuple(sorted(title for title, _ in quotes)),
    )


def _items(value: object) -> list[dict]:
    """The objects in a JSON array, or nothing when the value is not an array."""
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _price(outcomes: list[dict], team: object) -> float | None:
    """The price quoted for a team, when it is a finite number above 1."""
    for outcome in outcomes:
        if outcome.get("name") == team:
            price = outcome.get("price")
            if not isinstance(price, (int, float)):
                return None
            try:
                price = float(price)
            except OverflowError:
                return None
            return price if math.isfinite(price) and price > 1 else None
    return None
