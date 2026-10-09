"""
Tests for .github/workflows/pipeline.yml.

The workflow cannot be run here. These tests read it as text and hold it to
the few things that other files, or the safety of the key, depend on.
"""

import re
from datetime import datetime, timedelta
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


def test_wherever_the_workflow_gives_a_number_of_minutes_it_is_the_window_of_the_schedule():
    # The comment on the cron line and the descriptions of the two inputs say
    # for how long a slot may be asked for. schedule.py is where that is set.
    window = str(int(schedule.ATTEMPT_WINDOW.total_seconds() // 60))
    mentions = re.findall(r"(\d+) minutes", PIPELINE)

    assert len(mentions) == 3
    assert set(mentions) == {window}
    # Three triggers fit in the window, as the comment says.
    assert schedule.ATTEMPT_WINDOW // timedelta(minutes=30) + 1 == 3
    assert "which three of these triggers can" in PIPELINE


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


def step_named(name):
    """The text of one step of the job, from its name to the next step."""
    _, *steps = re.split(r"\n      - name: ", PIPELINE)
    (found,) = [text for text in steps if text.splitlines()[0] == name]
    return found


def test_what_was_written_is_pushed_although_the_snapshot_step_failed():
    # The pipeline writes each sport on its own and ends with a failure when
    # one of them failed. Without a status function in its condition, a step
    # is skipped as soon as an earlier one has failed.
    push = step_named("Commit the snapshot and push it to the data branch")
    (condition,) = re.findall(r"^        if: \$\{\{ (.*) \}\}$", push, flags=re.MULTILINE)

    assert condition.split(" && ") == [
        "!cancelled()",
        "steps.snapshot.outputs.changed == 'true'",
        "!inputs.dry_run",
    ]
    # The step that takes the snapshot has no condition of its own: it runs
    # only when the data branch was checked out.
    assert "\n        if:" not in step_named("Take the snapshot")


def test_the_commit_message_gives_the_count_for_each_prefix():
    # The pipeline puts the counts together ("v1 12 games, v1-dryrun 3 games")
    # and the step puts the slot in front of them.
    push = step_named("Commit the snapshot and push it to the data branch")

    assert "          WRITTEN: ${{ steps.snapshot.outputs.written }}\n" in push
    assert re.findall(r"git commit.*", push) == ['git commit --quiet -m "Snapshot $SLOT: $WRITTEN"']


def test_a_step_that_fails_fails_the_job():
    # That is what tells the owner. Nothing lets a failed step pass.
    assert "continue-on-error" not in PIPELINE
    assert "|| true" not in PIPELINE


def test_the_only_push_goes_to_the_data_branch_and_is_not_forced():
    assert re.findall(r"git push.*", PIPELINE) == ["git push --quiet origin HEAD:refs/heads/data"]


def test_shell_tracing_is_not_turned_on():
    assert not re.search(r"set [-+]\w*x|xtrace", PIPELINE)
