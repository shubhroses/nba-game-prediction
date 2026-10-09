"""
Tests for data_transformation/transform_data.py.

dbt is not executed here. subprocess.run is replaced by a fake that records
the command and returns a chosen exit status. The task is called through its
plain function (Task.fn), so no Prefect API or server is involved.
"""

import logging
import subprocess

import pytest

import transform_data


class FakeDbt:
    def __init__(self):
        self.calls = []
        self.returncode = 0
        self.stdout = "Done. PASS=15 WARN=0 ERROR=0 SKIP=0 TOTAL=15"
        self.stderr = ""

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, self.returncode, self.stdout, self.stderr)


@pytest.fixture
def dbt(monkeypatch):
    fake = FakeDbt()
    monkeypatch.setattr(transform_data.subprocess, "run", fake.run)
    monkeypatch.setenv("DBT_PROJECT_DIR", "/repo/nba_dbt")
    return fake


@pytest.fixture(autouse=True)
def all_log_records(caplog):
    caplog.set_level(logging.DEBUG)


def test_builds_the_dbt_project(dbt, caplog):
    transform_data.run_dbt_transformation.fn()

    # No --select: every model in the project is built, and "build" also runs
    # the schema tests.
    assert dbt.calls == [
        (
            ["dbt", "build", "--project-dir", "/repo/nba_dbt"],
            {"capture_output": True, "text": True},
        )
    ]
    assert "Running dbt command: dbt build --project-dir /repo/nba_dbt" in caplog.messages
    assert "dbt command succeeded." in caplog.messages


def test_exits_with_status_1_when_dbt_fails(dbt, caplog):
    dbt.returncode = 1
    dbt.stdout = "Failure in test unique_stg_nba__games_game_id"
    dbt.stderr = "something on stderr"

    with pytest.raises(SystemExit) as exit_info:
        transform_data.run_dbt_transformation.fn()

    assert exit_info.value.code == 1
    errors = [record.getMessage() for record in caplog.records if record.levelno == logging.ERROR]
    assert errors == [
        "dbt command failed.",
        "STDOUT:\nFailure in test unique_stg_nba__games_game_id",
        "STDERR:\nsomething on stderr",
    ]


def test_exits_with_status_1_when_dbt_is_not_installed(monkeypatch, caplog):
    def dbt_missing(command, **kwargs):
        raise FileNotFoundError(2, "No such file or directory", command[0])

    monkeypatch.setattr(transform_data.subprocess, "run", dbt_missing)

    with pytest.raises(SystemExit) as exit_info:
        transform_data.run_dbt_transformation.fn()

    assert exit_info.value.code == 1
    assert "Could not find 'dbt' executable. Is dbt installed and on your PATH?" in caplog.messages
