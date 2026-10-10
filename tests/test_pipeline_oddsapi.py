"""
Tests for pipeline/oddsapi.py.

The requests go to the fake server in tests/fake_odds_api.py on 127.0.0.1.
Nothing here reaches The Odds API, the key is a dummy and the prices and
scores are invented.

The module makes two requests, for odds and for scores. Every test of what
is sent once, of what counts as a refusal and of what an error may say runs
for both of them.
"""

import http.client
import socket
import traceback
import urllib.request
from datetime import datetime, timezone

import pytest

from fake_odds_api import FakeOddsApi, Received, event, score_event
from pipeline import oddsapi

# A made-up value. It is deliberately not shaped like a real key.
KEY = "fake-key-not-a-real-one"
NOW = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
EVENTS = [
    event(
        "e" * 32,
        "Boston Celtics",
        "New York Knicks",
        "2026-10-20T23:00:00Z",
        {"Book A": (1.50, 2.70)},
    )
]
SCORES = [
    score_event("d" * 32, "Miami Heat", "Chicago Bulls", "2026-10-19T23:30:00Z", (112, 104)),
    score_event("e" * 32, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", None, False),
]


@pytest.fixture
def api(monkeypatch):
    with FakeOddsApi(
        {"basketball_nba": EVENTS, "basketball_nba_preseason": []}, {"basketball_nba": SCORES}
    ) as fake:
        monkeypatch.setenv("ODDS_API_BASE_URL", fake.url)
        yield fake


def odds(sport="basketball_nba"):
    return oddsapi.fetch_odds(sport, KEY, NOW)


def scores(sport="basketball_nba"):
    return oddsapi.fetch_scores(sport, KEY)


@pytest.fixture(params=[odds, scores], ids=["odds", "scores"])
def fetch(request):
    """Each of the two requests in turn. What holds for one has to hold for the other."""
    return request.param


@pytest.fixture
def attempts(monkeypatch):
    """
    One entry for every time the module set out to send a request. This also
    counts the attempts that never reach a server.
    """
    made = []
    send = oddsapi._OPENER.open

    def counting_open(*args, **kwargs):
        made.append(1)
        return send(*args, **kwargs)

    monkeypatch.setattr(oddsapi._OPENER, "open", counting_open)
    return made


def assert_gives_nothing_away(error, base_url):
    """Neither the message nor the traceback may hold the key or the address that was asked."""
    shown = "".join(traceback.format_exception(error)) + repr(error)
    assert KEY not in shown
    assert "apiKey" not in shown
    assert base_url not in shown
    assert "/v4/sports" not in shown


def test_the_request_and_what_comes_back(api):
    response = oddsapi.fetch_odds("basketball_nba", KEY, NOW)

    assert api.requests == [
        Received(
            sport="basketball_nba",
            query={
                "apiKey": KEY,
                "regions": "us",
                "markets": "h2h",
                "oddsFormat": "decimal",
                "commenceTimeFrom": "2026-10-20T22:10:41Z",
            },
        )
    ]
    # The time is sent the way the provider's guide writes it, colons included.
    assert "commenceTimeFrom=2026-10-20T22:10:41Z" in api.requests[0].target
    assert response.events == EVENTS
    assert (response.remaining, response.used, response.last) == (499, 1, 1)


def test_the_scores_request_and_what_comes_back(api):
    response = oddsapi.fetch_scores("basketball_nba", KEY)

    # The key, and the three days back that are the most the provider offers.
    assert api.requests == [
        Received(sport="basketball_nba", query={"apiKey": KEY, "daysFrom": "3"}, endpoint="scores")
    ]
    assert api.requests[0].target.startswith("/v4/sports/basketball_nba/scores?")
    assert response.events == SCORES
    # Asking for past days makes the request cost two credits.
    assert (response.remaining, response.used, response.last) == (498, 2, 2)


@pytest.mark.usefixtures("api")
def test_a_response_without_events_is_a_success(fetch):
    response = fetch("basketball_nba_preseason")

    assert response.events == []
    assert (response.remaining, response.used, response.last) == (500, 0, 0)


def test_the_key_and_the_sport_are_escaped_in_the_url(api):
    awkward_key = "dummy key&regions=eu#x"

    with pytest.raises(oddsapi.Refused):
        oddsapi.fetch_odds("a/b?c", awkward_key, NOW)

    (received,) = api.requests
    assert received.sport == "a%2Fb%3Fc"
    assert received.query["apiKey"] == awkward_key
    assert received.query["regions"] == "us"


def test_the_key_and_the_sport_are_escaped_in_the_url_for_scores_too(api):
    awkward_key = "dummy key&daysFrom=1#x"

    with pytest.raises(oddsapi.Refused):
        oddsapi.fetch_scores("a/b?c", awkward_key)

    (received,) = api.requests
    assert (received.sport, received.endpoint) == ("a%2Fb%3Fc", "scores")
    assert received.query == {"apiKey": awkward_key, "daysFrom": "3"}


@pytest.mark.parametrize(
    ("status", "error_code", "message"),
    [
        (401, "INVALID_KEY", "HTTP 401 (INVALID_KEY)"),
        (401, "OUT_OF_USAGE_CREDITS", "HTTP 401 (OUT_OF_USAGE_CREDITS)"),
        (401, None, "HTTP 401"),
        (429, "EXCEEDED_FREQ_LIMIT", "HTTP 429 (EXCEEDED_FREQ_LIMIT)"),
        (422, "INVALID_COMMENCE_TIME_FROM", "HTTP 422 (INVALID_COMMENCE_TIME_FROM)"),
        (403, "not a code: <b>anything</b>", "HTTP 403"),
    ],
)
def test_a_refusal_is_asked_only_once(api, fetch, status, error_code, message):
    api.status, api.error_code = status, error_code

    with pytest.raises(oddsapi.Refused) as raised:
        fetch()

    assert str(raised.value) == message
    assert len(api.requests) == 1
    assert_gives_nothing_away(raised.value, api.url)


def test_an_unknown_sport_is_a_refusal(api, fetch):
    with pytest.raises(oddsapi.Refused) as raised:
        fetch("basketball_xyz")

    assert str(raised.value) == "HTTP 404 (UNKNOWN_SPORT)"
    assert len(api.requests) == 1


def test_a_redirect_is_not_followed(api, fetch):
    api.status = 302

    with pytest.raises(oddsapi.Refused) as raised:
        fetch()

    assert str(raised.value) == "HTTP 302"
    assert [received.sport for received in api.requests] == ["basketball_nba"]


# A failure that may pass is not tried again within the run either. The next
# trigger of the workflow, half an hour later, is the retry.


@pytest.mark.parametrize("status", [500, 502, 503])
def test_a_server_error_is_asked_only_once(api, fetch, status):
    api.status = status

    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    assert str(raised.value) == f"HTTP {status}"
    assert len(api.requests) == 1
    assert_gives_nothing_away(raised.value, api.url)


def test_a_refused_connection_is_tried_only_once(monkeypatch, attempts, fetch):
    with socket.socket() as placeholder:
        placeholder.bind(("127.0.0.1", 0))
        closed_port = placeholder.getsockname()[1]
    base_url = f"http://127.0.0.1:{closed_port}"
    monkeypatch.setenv("ODDS_API_BASE_URL", base_url)

    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    assert str(raised.value) == "ConnectionRefusedError: Connection refused"
    assert len(attempts) == 1
    assert_gives_nothing_away(raised.value, base_url)


def test_an_error_whose_text_holds_the_key_is_named_and_not_quoted(
    api, attempts, monkeypatch, fetch
):
    # http.client refuses a request target that has a space in it, and its
    # message quotes the whole target, query string and key included.
    with pytest.raises(http.client.InvalidURL, match=KEY):
        urllib.request.urlopen(f"{api.url}/a b?apiKey={KEY}", timeout=5)

    # A base URL can put a space there.
    monkeypatch.setenv("ODDS_API_BASE_URL", api.url + "/a b")
    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    assert str(raised.value) == "InvalidURL"
    assert len(attempts) == 1
    assert api.requests == []
    assert_gives_nothing_away(raised.value, api.url)


def test_the_timeout_is_20_seconds():
    assert oddsapi.TIMEOUT_SECONDS == 20


def test_a_request_that_times_out_is_sent_only_once(api, attempts, monkeypatch, fetch):
    monkeypatch.setattr(oddsapi, "TIMEOUT_SECONDS", 0.05)
    api.delay_seconds = 0.4

    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    assert str(raised.value) == "timed out"
    assert len(attempts) == 1
    assert len(api.requests) == 1
    assert_gives_nothing_away(raised.value, api.url)


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (b"<html>Service temporarily unavailable</html>", "the response was not JSON"),
        (b"", "the response was not JSON"),
        (b'{"message": "hello"}', "the response was not a list of events"),
    ],
)
def test_a_success_that_cannot_be_read_is_not_asked_for_again(api, fetch, body, message):
    api.raw_body = body

    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    assert str(raised.value) == message
    assert len(api.requests) == 1
    assert_gives_nothing_away(raised.value, api.url)


# Far deeper than any interpreter this runs on will follow. On Python 3.11 the
# parser gives up below 1,000 levels, on 3.12 and 3.13 below 10,000, and on
# 3.14 it gives up when the stack is used up, a little above 100,000.
NESTED_TOO_DEEP = b"[" * 1_000_000


def test_a_body_nested_too_deep_is_an_answer_that_cannot_be_read(api, fetch):
    # json.loads raises RecursionError for this, which is not a ValueError.
    api.raw_body = NESTED_TOO_DEEP

    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    # The class of the error and nothing of its text.
    assert str(raised.value) == "the response could not be read (RecursionError)"
    assert len(api.requests) == 1
    assert_gives_nothing_away(raised.value, api.url)


def test_a_refusal_whose_body_is_nested_too_deep_is_still_a_refusal(api, fetch):
    api.status, api.raw_body = 401, NESTED_TOO_DEEP

    with pytest.raises(oddsapi.Refused) as raised:
        fetch()

    assert str(raised.value) == "HTTP 401"
    assert len(api.requests) == 1


def test_an_error_nobody_foresaw_is_named_and_not_quoted(api, monkeypatch, fetch):
    def fail(request, **kwargs):
        raise RuntimeError(f"could not open {request.full_url}")

    monkeypatch.setattr(oddsapi._OPENER, "open", fail)

    with pytest.raises(oddsapi.Unreachable) as raised:
        fetch()

    assert str(raised.value) == "RuntimeError"
    assert api.requests == []
    assert_gives_nothing_away(raised.value, api.url)


@pytest.mark.parametrize(
    ("header", "number"),
    [
        ("498", 498),
        ("0", 0),
        ("498.0", 498),
        (None, None),
        ("", None),
        ("many", None),
        ("1.5", None),
    ],
)
def test_a_quota_header_is_a_whole_number_or_unknown(header, number):
    assert oddsapi._count(header) == number


def test_the_address_is_the_providers_unless_the_variable_names_this_machine(monkeypatch):
    monkeypatch.delenv("ODDS_API_BASE_URL", raising=False)
    assert oddsapi.base_url() == "https://api.the-odds-api.com"

    monkeypatch.setenv("ODDS_API_BASE_URL", "")
    assert oddsapi.base_url() == "https://api.the-odds-api.com"

    for local in ("http://127.0.0.1:8765", "http://localhost:8765/", "http://[::1]:8765"):
        monkeypatch.setenv("ODDS_API_BASE_URL", local)
        assert oddsapi.base_url() == local.rstrip("/")


@pytest.mark.parametrize(
    "elsewhere",
    [
        "https://example.com",
        "http://127.0.0.1.example.com:8765",
        "http://localhost@example.com",
        "file:///tmp/odds.json",
        "localhost:8765",
    ],
)
def test_any_other_address_is_refused_before_a_request_is_made(monkeypatch, fetch, elsewhere):
    monkeypatch.setenv("ODDS_API_BASE_URL", elsewhere)

    with pytest.raises(ValueError, match="may only name a server on this machine") as raised:
        fetch()

    assert elsewhere not in str(raised.value)
