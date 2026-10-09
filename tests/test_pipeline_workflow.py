"""
Tests for .github/workflows/pipeline.yml.

The workflow cannot be run here. These tests read it as text and hold it to
the few things that other files, or the safety of the key, depend on.
"""

import re
from datetime import datetime
from pathlib import Path

from pipeline import schedule

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"
PIPELINE = (WORKFLOWS / "pipeline.yml").read_text()
CI = (WORKFLOWS / "ci.yml").read_text()


def test_every_slot_starts_on_a_trigger():
    minutes, hours = re.search(r'cron: "(\S+) (\S+) \* \* \*"', PIPELINE).groups()
    trigger_minutes = {int(minute) for minute in minutes.split(",")}

    assert hours == "*"
    assert trigger_minutes == {10, 40}
    assert {slot.minute for slot in schedule.SLOT_TIMES} <= trigger_minutes
    # A minute in New York is the same minute in UTC only because the offset
    # is a whole number of hours, in summer and in winter.
    for month in (1, 7):
        offset = datetime(2026, month, 15, tzinfo=schedule.ZONE).utcoffset()
        assert offset.total_seconds() % 3600 == 0


def test_the_actions_are_the_ones_ci_uses_pinned_to_the_same_commits():
    used = set(re.findall(r"uses: (\S+)", PIPELINE))

    assert {action.split("@")[0] for action in used} == {"actions/checkout", "actions/setup-python"}
    assert all(re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", action) for action in used)
    assert used <= set(re.findall(r"uses: (\S+)", CI))


def test_the_token_can_only_read_except_in_the_job_that_pushes():
    assert "\npermissions:\n  contents: read\n" in PIPELINE
    assert re.findall(r"^ +(\w[\w-]*): write\b", PIPELINE, flags=re.MULTILINE) == ["contents"]


def test_the_api_key_is_given_to_one_step():
    assert re.findall(r"secrets\.\w+", PIPELINE) == ["secrets.ODDS_API_KEY"]
    # Counting the uses is not enough. In the job's own env, which is the text
    # before the first step, a single use would reach every step.
    job, *steps = re.split(r"\n      - name: ", PIPELINE)
    assert "secrets." not in job
    (step,) = [step for step in steps if "secrets." in step]
    assert step.splitlines()[0] == "Take the snapshot"
    # The step that has the key does not have the token that can push.
    assert "github.token" not in step


def test_runs_wait_for_each_other_and_none_is_cancelled():
    # A run that is cancelled after its request has spent a credit and
    # recorded nothing, and the next run would ask again.
    assert "\nconcurrency:\n  group: odds-snapshot\n  cancel-in-progress: false\n" in PIPELINE


def test_the_only_push_goes_to_the_data_branch_and_is_not_forced():
    assert re.findall(r"git push.*", PIPELINE) == ["git push --quiet origin HEAD:refs/heads/data"]


def test_shell_tracing_is_not_turned_on():
    assert not re.search(r"set [-+]\w*x|xtrace", PIPELINE)
