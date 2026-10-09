"""
Reads the files of the previous run and writes those of this one.

The data directory is a checkout of the data branch. On the first run it
does not exist yet, and every read reports "nothing there".
"""

import json
import os
import shutil
import tempfile
from datetime import date
from pathlib import Path


def slate_path(prefix: str) -> str:
    return f"{prefix}/slate.json"


def state_path(prefix: str) -> str:
    return f"{prefix}/state.json"


def history_path(prefix: str, day: date) -> str:
    """The history file for the snapshots taken on one UTC date."""
    return f"{prefix}/history/{day.isoformat()}.ndjson"


def read_json(data_dir: Path, path: str) -> object | None:
    """The parsed file, or None when it does not exist. Raises ValueError when it is not JSON."""
    try:
        content = (data_dir / path).read_bytes()
    except FileNotFoundError:
        return None
    return json.loads(content)


def read_text(data_dir: Path, path: str) -> str:
    """The file's content, or an empty string when it does not exist."""
    try:
        return (data_dir / path).read_bytes().decode("utf-8")
    except FileNotFoundError:
        return ""


def to_json(document: object) -> str:
    """Sorted keys, a two-space indent and a final newline, so that two snapshots diff cleanly."""
    return json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + "\n"


def to_ndjson(lines: list[dict]) -> str:
    """One compact JSON object per line, with the keys in the order given."""
    return "".join(
        json.dumps(line, separators=(",", ":"), allow_nan=False) + "\n" for line in lines
    )


def write(data_dir: Path, files: dict[str, str]) -> None:
    """
    Writes the files in such a way that a failure while writing leaves the
    data directory as it was. Call this only with content that has passed
    validation.

    `files` maps a path inside the data directory to the complete new content.
    Everything is first written to a temporary directory. Only when that has
    worked is each file moved to its place, in the order given, with a rename
    that replaces the old file in one step, so a reader never sees a
    half-written file. The moves are one rename per file and not one step
    together; the caller lists the state file last, so that an interruption
    between two renames leaves the old state and the next run starts over.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    # Inside the data directory, so that the renames stay on one file system.
    staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=data_dir))
    try:
        for path, content in files.items():
            (staging / path).parent.mkdir(parents=True, exist_ok=True)
            (staging / path).write_bytes(content.encode("utf-8"))
        for path in files:
            (data_dir / path).parent.mkdir(parents=True, exist_ok=True)
        for path in files:
            os.replace(staging / path, data_dir / path)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
