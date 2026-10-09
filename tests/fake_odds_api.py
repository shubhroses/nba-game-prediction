"""
A local stand-in for The Odds API.

The tests start it on a free port and point the pipeline at it through
ODDS_API_BASE_URL. It also runs by hand, to try the pipeline without a key:

    python tests/fake_odds_api.py --port 8765

Every game and every price it serves is invented. It answers one path,
GET /v4/sports/<sport>/odds, in the shape of the real response, and sends the
three quota headers. Unlike the real API it ignores commenceTimeFrom and
returns whatever it was given, so the tests can check that the pipeline
leaves out a started game by itself.
"""

import argparse
import contextlib
import json
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

ODDS_PATH = re.compile(r"/v4/sports/([^/]+)/odds/?")


def event(event_id, home, away, commence_time, prices, sport="basketball_nba"):
    """
    One event as the API returns it. `prices` maps a sportsbook's title to
    its (home price, away price); a price of None leaves that side out.
    """
    bookmakers = []
    for title, (price_home, price_away) in prices.items():
        outcomes = [
            {"name": team, "price": price}
            for team, price in ((home, price_home), (away, price_away))
            if price is not None
        ]
        bookmakers.append(
            {
                "key": re.sub(r"[^a-z0-9]", "", title.lower()),
                "title": title,
                "last_update": "2026-10-01T00:00:00Z",
                "markets": [
                    {"key": "h2h", "last_update": "2026-10-01T00:00:00Z", "outcomes": outcomes}
                ],
            }
        )
    return {
        "id": event_id,
        "sport_key": sport,
        "sport_title": "NBA",
        "commence_time": commence_time,
        "home_team": home,
        "away_team": away,
        "bookmakers": bookmakers,
    }


@dataclass(frozen=True)
class Received:
    """One request the fake server got."""

    sport: str
    query: dict  # the query string, decoded
    target: str = field(default="", compare=False)  # the path and query string as they arrived


class FakeOddsApi:
    """
    with FakeOddsApi({"basketball_nba": [event(...), ...]}) as api:
        api.url        where it listens, for ODDS_API_BASE_URL
        api.requests   every request received so far
        api.status     set to 401, 429, 503 ... to make it refuse or fail

    `events` maps a sport key to its events, or is a function that returns
    such a mapping when a request comes in. A sport that is not in the
    mapping gets a 404 with UNKNOWN_SPORT, one of the provider's error codes.
    """

    def __init__(self, events=None, *, port=0, verbose=False):
        self.events = events or {}
        self.status = 200
        self.error_code = None
        self.raw_body = None  # bytes to send instead of the events, with status 200
        self.delay_seconds = 0
        self.remaining, self.used = 500, 0
        self.requests = []
        self.verbose = verbose
        self._server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self._server.api = self
        self._thread = None

    @property
    def url(self):
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    def __enter__(self):
        # The short poll interval is how quickly the server notices shutdown().
        self._thread = threading.Thread(
            target=self._server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        self._thread.start()
        return self

    def __exit__(self, *exc_info):
        self._server.shutdown()
        self._server.server_close()
        self._thread.join()

    def serve_forever(self):
        self._server.serve_forever()


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        api = self.server.api
        parts = urlsplit(self.path)
        match = ODDS_PATH.fullmatch(parts.path)
        if not match:
            return self._send(404, {"message": "Not found"})
        sport = match.group(1)
        query = dict(parse_qsl(parts.query))
        api.requests.append(Received(sport=sport, query=query, target=self.path))
        if api.delay_seconds:
            time.sleep(api.delay_seconds)

        if api.status != 200:
            error = {"message": f"The fake server was told to answer {api.status}."}
            if api.error_code:
                error["error_code"] = api.error_code
            return self._send(api.status, error)
        if api.raw_body is not None:
            return self._send(200, api.raw_body)
        events = (api.events() if callable(api.events) else api.events).get(sport)
        if events is None:
            return self._send(404, {"message": "Unknown sport", "error_code": "UNKNOWN_SPORT"})

        # One region and one market cost one credit. A response without
        # events costs nothing, as the provider's guide says.
        cost = 1 if events else 0
        api.remaining -= cost
        api.used += cost
        quota = {
            "x-requests-remaining": api.remaining,
            "x-requests-used": api.used,
            "x-requests-last": cost,
        }
        return self._send(200, events, quota)

    def _send(self, status, body, headers=None):
        payload = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if 300 <= status < 400:
            self.send_header("Location", "/v4/sports/redirected/odds")
        for name, value in (headers or {}).items():
            self.send_header(name, str(value))
        try:
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            return  # the client gave up waiting, which is what the timeout test wants
        if self.server.api.verbose:
            # The path only. The query string holds the key.
            print(f"GET {urlsplit(self.path).path} -> {status}", flush=True)

    def log_message(self, *args):
        """The default prints the request line to stderr, key included. Print nothing."""


def sample_events(first_start, request_number=0):
    """
    Invented games for the two sports the pipeline captures. The start times
    count from `first_start`. The prices move a little with each request, so
    that a second snapshot differs from the first.
    """
    drift = 0.01 * (request_number % 5)

    def at(hours):
        return (first_start + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

    regular_season = [
        event(
            "000000000000000000000000000000a1",
            "Boston Celtics",
            "New York Knicks",
            at(0),
            {
                "Book One": (1.50 + drift, 2.70),
                "Book Two": (1.52, 2.62 - drift),
                "Book Three": (1.48, 2.75),
            },
        ),
        event(
            "000000000000000000000000000000a2",
            "Denver Nuggets",
            "Los Angeles Lakers",
            at(3),
            {"Book One": (1.91, 1.91), "Book Two": (1.87 + drift, 1.95)},
        ),
        # Listed, but no sportsbook quotes it yet.
        event("000000000000000000000000000000a3", "Miami Heat", "Chicago Bulls", at(24), {}),
    ]
    preseason = [
        event(
            "000000000000000000000000000000b1",
            "Utah Jazz",
            "Phoenix Suns",
            at(1),
            {"Book One": (2.30 - drift, 1.65), "Book Two": (2.25, 1.68)},
            sport="basketball_nba_preseason",
        ),
        # Preseason games against clubs from outside the league do occur.
        # The pipeline has no code for this team and must leave the game out.
        event(
            "000000000000000000000000000000b2",
            "Toronto Raptors",
            "Example Visitors",
            at(2),
            {"Book One": (1.20, 4.60)},
            sport="basketball_nba_preseason",
        ),
    ]
    return {"basketball_nba": regular_season, "basketball_nba_preseason": preseason}


def main():
    parser = argparse.ArgumentParser(
        description="A local stand-in for The Odds API, with invented data."
    )
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    first_start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    first_start += timedelta(days=1)
    api = FakeOddsApi(port=args.port, verbose=True)
    api.events = lambda: sample_events(first_start, request_number=len(api.requests))
    print(f"Fake Odds API with invented games on {api.url}. Stop it with Ctrl+C.", flush=True)
    with contextlib.suppress(KeyboardInterrupt):
        api.serve_forever()


if __name__ == "__main__":
    main()
