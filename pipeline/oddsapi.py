"""
The one request this job makes: the upcoming games of a sport from The Odds
API, with each US sportsbook's head-to-head prices.

The API takes its key in the query string, so the URL is a secret. Nothing in
this module logs, and the errors it raises are built from the status code,
the provider's error code and the kind of failure only. They never carry the
URL, the key or the text of an underlying exception.
"""

import http.client
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime

from pipeline.timestamps import format_utc

DEFAULT_BASE_URL = "https://api.the-odds-api.com"
BASE_URL_VARIABLE = "ODDS_API_BASE_URL"
TIMEOUT_SECONDS = 20
# Sent in place of urllib's default name, which some gateways reject.
USER_AGENT = "nba-game-prediction-pipeline"

_LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")
# The provider's error codes look like INVALID_KEY or OUT_OF_USAGE_CREDITS.
# Only text of that shape is copied from an error body into a message.
_ERROR_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,59}")


class OddsApiError(Exception):
    """A request that did not produce events. The message is safe to print."""


class Refused(OddsApiError):
    """The provider answered and said no. Asking again would get the same answer."""


class Unreachable(OddsApiError):
    """No usable answer: a network error, a timeout, a 5xx status or a body that cannot be read."""


@dataclass(frozen=True)
class OddsResponse:
    events: list  # the events as the API returned them
    remaining: int | None  # x-requests-remaining: credits left until the quota resets
    used: int | None  # x-requests-used: credits used since the last reset
    last: int | None  # x-requests-last: what this call cost


def fetch_odds(sport: str, api_key: str, now: datetime) -> OddsResponse:
    """
    The games of a sport that start at or after now, with the prices of the
    US sportsbooks, and the quota headers of the response.

    One request is sent, and it is not repeated whatever comes of it. Any
    request may cost a credit, and the job is triggered again half an hour
    later: that trigger is the retry. 401 and 429 raise Refused, and so does
    any other answer that is neither a success nor a 5xx. A network error, a
    timeout, a 5xx status or a success that cannot be read raises Unreachable.
    """
    query = urllib.parse.urlencode(
        {
            "apiKey": api_key,
            "regions": "us",
            "markets": "h2h",
            "oddsFormat": "decimal",
            # Without this the response also lists games that are in play.
            "commenceTimeFrom": format_utc(now),
        },
        safe=":",  # the time goes out as the provider's guide writes it, 2026-10-20T22:10:41Z
    )
    url = f"{base_url()}/v4/sports/{urllib.parse.quote(sport, safe='')}/odds?{query}"
    return _get(url)


def base_url() -> str:
    """
    The provider's address, or a server on this machine when
    ODDS_API_BASE_URL is set, which is how the tests reach
    tests/fake_odds_api.py. Any other address raises ValueError, so that a
    stray setting cannot send the key somewhere else.
    """
    override = os.environ.get(BASE_URL_VARIABLE, "").strip()
    if not override:
        return DEFAULT_BASE_URL
    parts = urllib.parse.urlsplit(override)
    if parts.scheme not in ("http", "https") or parts.hostname not in _LOCAL_HOSTS:
        raise ValueError(
            f"{BASE_URL_VARIABLE} may only name a server on this machine, "
            "for example http://127.0.0.1:8765"
        )
    return override.rstrip("/")


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """The request carries the key, so it goes to the address it was built for and nowhere else."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirects)


def _get(url: str) -> OddsResponse:
    request = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
    )
    try:
        with _OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
            headers = response.headers
            body = response.read()
    except urllib.error.HTTPError as error:
        try:
            if error.code >= 500:
                raise Unreachable(f"HTTP {error.code}") from None
            raise Refused(_refusal(error)) from None
        finally:
            error.close()
    except (OSError, http.client.HTTPException) as error:
        raise Unreachable(_kind(error)) from None
    except Exception as error:
        # An error that nobody foresaw. Only its class is passed on: its text
        # may quote the URL, and with it the key.
        raise Unreachable(type(error).__name__) from None

    try:
        events = json.loads(body)
    except ValueError:
        raise Unreachable("the response was not JSON") from None
    except Exception as error:
        # For example RecursionError, for a body that is nested too deep.
        raise Unreachable(f"the response could not be read ({type(error).__name__})") from None
    if not isinstance(events, list):
        raise Unreachable("the response was not a list of events")
    return OddsResponse(
        events=events,
        remaining=_count(headers.get("x-requests-remaining")),
        used=_count(headers.get("x-requests-used")),
        last=_count(headers.get("x-requests-last")),
    )


def _refusal(error: urllib.error.HTTPError) -> str:
    """The status, with the provider's error code when the body has one: HTTP 401 (INVALID_KEY)."""
    try:
        code = json.loads(error.read()).get("error_code")
    except Exception:
        # The status says enough. A body that cannot be read, for whatever
        # reason, only means that there is no error code to show with it.
        code = None
    if isinstance(code, str) and _ERROR_CODE.fullmatch(code):
        return f"HTTP {error.code} ({code})"
    return f"HTTP {error.code}"


def _kind(error: Exception) -> str:
    """
    What went wrong, in words that cannot contain the URL: "timed out", or
    the class of the error with the operating system's own description.
    """
    cause = error.reason if isinstance(error, urllib.error.URLError) else error
    if not isinstance(cause, Exception):
        return type(error).__name__
    if isinstance(cause, TimeoutError):
        return "timed out"
    if isinstance(cause, OSError) and cause.strerror:
        return f"{type(cause).__name__}: {cause.strerror}"
    return type(cause).__name__


def _count(header: str | None) -> int | None:
    """A quota header as a whole number, or None when it is missing or is not one."""
    try:
        number = float(header)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else None
