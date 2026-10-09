"""
Tests for pipeline/store.py: the file formats on disk, and the rule that a
write puts every file in place or none.
"""

import json
import os
from datetime import date

import pytest

from pipeline import store


def files_under(directory):
    return sorted(
        str(path.relative_to(directory)) for path in directory.rglob("*") if path.is_file()
    )


def test_the_paths_of_the_three_files():
    assert store.slate_path("v1") == "v1/slate.json"
    assert store.state_path("v1") == "v1/state.json"
    assert store.history_path("v1", date(2026, 10, 20)) == "v1/history/2026-10-20.ndjson"


def test_a_data_directory_that_does_not_exist_yet_reads_as_empty(tmp_path):
    missing = tmp_path / "not" / "created" / "yet"

    assert store.read_json(missing, "v1/state.json") is None
    assert store.read_text(missing, "v1/history/2026-10-20.ndjson") == ""
    assert not missing.exists()


def test_json_is_written_with_sorted_keys_two_spaces_and_a_final_newline():
    document = {"schema": 1, "games": [{"id": "g", "home": "BOS"}], "credits": {"used": 2}}

    assert store.to_json(document) == (
        "{\n"
        '  "credits": {\n'
        '    "used": 2\n'
        "  },\n"
        '  "games": [\n'
        "    {\n"
        '      "home": "BOS",\n'
        '      "id": "g"\n'
        "    }\n"
        "  ],\n"
        '  "schema": 1\n'
        "}\n"
    )


def test_history_lines_are_compact_and_keep_their_field_order():
    lines = [
        {
            "id": "g",
            "at": "2026-10-20T22:10:41Z",
            "p_home": 0.6214,
            "lo": 0.6,
            "hi": 0.6429,
            "n": 2,
        },
        {"id": "h", "at": "2026-10-20T22:10:41Z", "p_home": 0.5, "lo": 0.5, "hi": 0.5, "n": 1},
    ]

    assert store.to_ndjson(lines) == (
        '{"id":"g","at":"2026-10-20T22:10:41Z","p_home":0.6214,"lo":0.6,"hi":0.6429,"n":2}\n'
        '{"id":"h","at":"2026-10-20T22:10:41Z","p_home":0.5,"lo":0.5,"hi":0.5,"n":1}\n'
    )
    assert store.to_ndjson([]) == ""


def test_a_value_that_is_not_a_number_cannot_be_written():
    with pytest.raises(ValueError, match="not JSON compliant"):
        store.to_json({"p_home": float("nan")})
    with pytest.raises(ValueError, match="not JSON compliant"):
        store.to_ndjson([{"p_home": float("inf")}])


def test_write_creates_the_directories_and_replaces_what_was_there(tmp_path):
    data_dir = tmp_path / "data"
    store.write(data_dir, {"v1/state.json": '{"n": 1}\n', "v1/history/2026-10-20.ndjson": "a\n"})

    store.write(data_dir, {"v1/state.json": '{"n": 2}\n', "v1/history/2026-10-20.ndjson": "a\nb\n"})

    assert files_under(data_dir) == ["v1/history/2026-10-20.ndjson", "v1/state.json"]
    assert not list(data_dir.glob(".staging-*"))
    assert store.read_json(data_dir, "v1/state.json") == {"n": 2}
    assert store.read_text(data_dir, "v1/history/2026-10-20.ndjson") == "a\nb\n"


def test_a_failure_while_writing_leaves_the_data_directory_as_it_was(tmp_path):
    data_dir = tmp_path / "data"
    store.write(data_dir, {"v1/slate.json": "old slate\n", "v1/state.json": "old state\n"})

    # The second file cannot be encoded, so writing it to the temporary directory fails.
    with pytest.raises(UnicodeEncodeError):
        store.write(data_dir, {"v1/slate.json": "new slate\n", "v1/state.json": "\ud800"})

    assert files_under(data_dir) == ["v1/slate.json", "v1/state.json"]
    assert not list(data_dir.glob(".staging-*"))
    assert store.read_text(data_dir, "v1/slate.json") == "old slate\n"
    assert store.read_text(data_dir, "v1/state.json") == "old state\n"


def test_files_are_moved_into_place_in_the_order_given(tmp_path, monkeypatch):
    moved = []
    replace = os.replace

    def recording_replace(source, destination):
        moved.append(str(destination.relative_to(tmp_path)))
        replace(source, destination)

    monkeypatch.setattr(store.os, "replace", recording_replace)

    store.write(
        tmp_path, {"v1/history/d.ndjson": "h\n", "v1/slate.json": "s\n", "v1/state.json": "t\n"}
    )

    assert moved == ["v1/history/d.ndjson", "v1/slate.json", "v1/state.json"]


def test_a_file_that_is_not_json_is_an_error_not_a_missing_file(tmp_path):
    (tmp_path / "v1").mkdir()
    (tmp_path / "v1" / "state.json").write_text("")

    with pytest.raises(json.JSONDecodeError):
        store.read_json(tmp_path, "v1/state.json")
