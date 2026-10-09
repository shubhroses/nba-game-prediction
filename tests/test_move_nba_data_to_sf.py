"""
Tests for data_ingestion/move_nba_data_to_sf.py.

Nothing here opens a network connection. boto3.client and
snowflake.connector.connect are replaced by the fakes below for every test.
The fakes record what the script asks for and answer the way S3 and Snowflake
answer the statements this script is expected to send.
"""

import logging
from datetime import datetime, timezone

import pytest
import snowflake.connector.errors

import move_nba_data_to_sf as loader

BUCKET = "test-bucket"

# Made-up values. They are deliberately not shaped like real AWS keys.
AWS_KEY_ID = "fake-aws-access-key-id"
AWS_SECRET = "fake-aws-secret-access-key"
SNOWFLAKE_PASSWORD = "fake-snowflake-password"
CREDENTIALS = (AWS_KEY_ID, AWS_SECRET, SNOWFLAKE_PASSWORD)

ENVIRONMENT = {
    "AWS_ACCESS_KEY_ID": AWS_KEY_ID,
    "AWS_SECRET_ACCESS_KEY": AWS_SECRET,
    "AWS_REGION": "us-west-2",
    "S3_BUCKET_NAME": BUCKET,
    "SNOWFLAKE_USER": "test_user",
    "SNOWFLAKE_PASSWORD": SNOWFLAKE_PASSWORD,
    "SNOWFLAKE_ACCOUNT": "test_account",
    "SNOWFLAKE_ROLE": "TEST_ROLE",
    "SNOWFLAKE_WAREHOUSE": "TEST_WH",
    "SNOWFLAKE_DATABASE": "TEST_DB",
    "SNOWFLAKE_SCHEMA": "TEST_SCHEMA",
}

OLDER_FILE = "nba_scoreboard_20241230_194424.json"
NEWEST_FILE = "nba_scoreboard_20241231_201500.json"

# S3 does not list objects in order of modification time, so the newest object
# is deliberately not the last one here.
S3_OBJECTS = [
    {
        "Key": f"raw/{NEWEST_FILE}",
        "LastModified": datetime(2024, 12, 31, 20, 15, tzinfo=timezone.utc),
    },
    {
        "Key": f"raw/{OLDER_FILE}",
        "LastModified": datetime(2024, 12, 30, 19, 44, tzinfo=timezone.utc),
    },
    {
        "Key": "raw/nba_scoreboard_20241229_180000.json",
        "LastModified": datetime(2024, 12, 29, 18, 0, tzinfo=timezone.utc),
    },
]

SESSION_CONTEXT_SQL = (
    "SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE(), "
    "CURRENT_DATABASE(), CURRENT_SCHEMA()"
)
CREATE_TABLE_SQL = "CREATE TABLE IF NOT EXISTS RAW_NBA_SCOREBOARD ( game_data VARIANT )"
SHOW_GRANTS_SQL = "SHOW GRANTS ON TABLE RAW_NBA_SCOREBOARD"
CREATE_STAGE_SQL = (
    "CREATE OR REPLACE STAGE nba_stage "
    f"URL='s3://{BUCKET}/raw/' "
    f"CREDENTIALS=( AWS_KEY_ID='{AWS_KEY_ID}' AWS_SECRET_KEY='{AWS_SECRET}' ) "
    "FILE_FORMAT=(TYPE=JSON)"
)
COPY_SQL = (
    "COPY INTO RAW_NBA_SCOREBOARD "
    f"FROM @nba_stage/{NEWEST_FILE} "
    "FILE_FORMAT=(TYPE=JSON) "
    "ON_ERROR='CONTINUE'"
)

# The columns COPY INTO <table> returns for each file it handles, as listed in
# the "Output" section of Snowflake's COPY INTO <table> reference.
COPY_COLUMNS = (
    "file",
    "status",
    "rows_parsed",
    "rows_loaded",
    "error_limit",
    "errors_seen",
    "first_error",
    "first_error_line",
    "first_error_character",
    "first_error_column_name",
)
STAGED_FILE = f"s3://{BUCKET}/raw/{NEWEST_FILE}"

COPY_LOADED = (COPY_COLUMNS, [(STAGED_FILE, "LOADED", 1, 1, 1, 0, None, None, None, None)])
# A COPY INTO that loads no file returns one row with a status message only.
COPY_NO_FILES = (("status",), [("Copy executed with 0 files processed.",)])
# The other form in which a file that was loaded before can come back.
COPY_LOAD_SKIPPED = (
    COPY_COLUMNS,
    [(STAGED_FILE, "LOAD_SKIPPED", 0, 0, 1, 1, "File was loaded before.", None, None, None)],
)
COPY_LOAD_FAILED = (
    COPY_COLUMNS,
    [(STAGED_FILE, "LOAD_FAILED", 1, 0, 1, 1, "Error parsing JSON: unknown keyword", 1, 2, None)],
)
COPY_NO_ROWS = (COPY_COLUMNS, [])


def normalise(sql):
    """Collapses runs of whitespace so statements can be compared as text."""
    return " ".join(sql.split())


def syntax_error(statement):
    return snowflake.connector.errors.ProgrammingError(
        msg=f"SQL compilation error: syntax error in statement '{statement[:30]}'.",
        errno=1003,
        sqlstate="42000",
    )


class FakeS3:
    def __init__(self, objects):
        self.objects = list(objects)
        self.client_calls = []
        self.list_calls = []

    def client(self, service_name, **kwargs):
        self.client_calls.append((service_name, kwargs))
        return self

    def list_objects_v2(self, **kwargs):
        self.list_calls.append(kwargs)
        if not self.objects:
            return {"KeyCount": 0}
        return {"KeyCount": len(self.objects), "Contents": list(self.objects)}


class FakeSnowflake:
    """
    Stands in for a Snowflake account. Every statement executed on any cursor
    is appended to 'statements'. A statement the script is not expected to send
    raises the syntax error Snowflake would raise for something it cannot parse.
    """

    def __init__(self):
        self.connect_calls = []
        self.connections = []
        self.statements = []
        self.copy_result = COPY_LOADED
        self.copy_error = None

    def connect(self, **kwargs):
        self.connect_calls.append(kwargs)
        connection = FakeConnection(self)
        self.connections.append(connection)
        return connection

    def run(self, sql):
        self.statements.append(sql)
        statement = normalise(sql)
        if statement == SESSION_CONTEXT_SQL:
            return (
                ("CURRENT_USER()", "CURRENT_ROLE()", "CURRENT_WAREHOUSE()",
                 "CURRENT_DATABASE()", "CURRENT_SCHEMA()"),
                [("TEST_USER", "TEST_ROLE", "TEST_WH", "TEST_DB", "TEST_SCHEMA")],
            )
        if statement == CREATE_TABLE_SQL:
            return (("status",), [("RAW_NBA_SCOREBOARD already exists, statement succeeded.",)])
        if statement == SHOW_GRANTS_SQL:
            return (
                ("created_on", "privilege", "granted_on", "name", "granted_to", "grantee_name"),
                [("2024-12-30", "OWNERSHIP", "TABLE", "RAW_NBA_SCOREBOARD", "ROLE", "TEST_ROLE")],
            )
        if statement.startswith("CREATE OR REPLACE STAGE nba_stage "):
            return (("status",), [("Stage area NBA_STAGE successfully created.",)])
        if statement.startswith("COPY INTO RAW_NBA_SCOREBOARD "):
            if self.copy_error is not None:
                raise self.copy_error
            return self.copy_result
        raise syntax_error(statement)


class FakeConnection:
    def __init__(self, account):
        self.account = account
        self.closed = False

    def cursor(self):
        return FakeCursor(self.account)

    def close(self):
        self.closed = True


class FakeCursor:
    def __init__(self, account):
        self.account = account
        self.description = None
        self.rows = []
        self.closed = False

    def execute(self, sql):
        columns, rows = self.account.run(sql)
        # Like DB-API cursors, describe each column with a 7-item sequence
        # whose first item is the column name.
        self.description = [(name, None, None, None, None, None, True) for name in columns]
        self.rows = list(rows)
        return self

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def environment(monkeypatch):
    for name, value in ENVIRONMENT.items():
        monkeypatch.setenv(name, value)


@pytest.fixture(autouse=True)
def s3(monkeypatch):
    fake = FakeS3(S3_OBJECTS)
    monkeypatch.setattr(loader.boto3, "client", fake.client)
    return fake


@pytest.fixture(autouse=True)
def snowflake_account(monkeypatch):
    fake = FakeSnowflake()
    monkeypatch.setattr(loader.snowflake.connector, "connect", fake.connect)
    return fake


@pytest.fixture(autouse=True)
def all_log_records(caplog):
    caplog.set_level(logging.DEBUG)


def messages(caplog, level=None):
    return [
        record.getMessage()
        for record in caplog.records
        if level is None or record.levelno == level
    ]


def test_statements_are_issued_in_order(snowflake_account):
    loader.main()

    assert [normalise(sql) for sql in snowflake_account.statements] == [
        # create_table_if_not_exists()
        SESSION_CONTEXT_SQL,
        CREATE_TABLE_SQL,
        SHOW_GRANTS_SQL,
        # load_json_data_from_s3_to_snowflake()
        SESSION_CONTEXT_SQL,
        CREATE_STAGE_SQL,
        COPY_SQL,
    ]


def test_copy_does_not_force_a_reload(snowflake_account):
    loader.main()

    copy_statements = [
        sql for sql in snowflake_account.statements if normalise(sql).startswith("COPY INTO")
    ]
    assert len(copy_statements) == 1
    # FORCE = TRUE would make Snowflake load a file again even though its load
    # metadata says the file is already in the table.
    assert "FORCE" not in copy_statements[0].upper()


def test_connects_with_the_configured_settings_and_closes_both_connections(s3, snowflake_account):
    loader.main()

    expected_connection = {
        "user": "test_user",
        "password": SNOWFLAKE_PASSWORD,
        "account": "test_account",
        "role": "TEST_ROLE",
        "warehouse": "TEST_WH",
        "database": "TEST_DB",
        "schema": "TEST_SCHEMA",
    }
    assert snowflake_account.connect_calls == [expected_connection, expected_connection]
    assert [connection.closed for connection in snowflake_account.connections] == [True, True]

    assert s3.client_calls == [
        (
            "s3",
            {
                "aws_access_key_id": AWS_KEY_ID,
                "aws_secret_access_key": AWS_SECRET,
                "region_name": "us-west-2",
            },
        )
    ]
    assert s3.list_calls == [{"Bucket": BUCKET, "Prefix": "raw/"}]


def test_most_recently_modified_file_is_chosen():
    assert loader.get_most_recent_s3_file(prefix="raw/") == f"raw/{NEWEST_FILE}"


@pytest.mark.parametrize(
    "copy_result",
    [COPY_LOADED, COPY_NO_FILES, COPY_LOAD_SKIPPED, COPY_LOAD_FAILED],
    ids=["loaded", "no-files-processed", "load-skipped", "load-failed"],
)
def test_no_credential_in_any_log_line(caplog, snowflake_account, copy_result):
    snowflake_account.copy_result = copy_result

    loader.main()

    # The real key pair has to reach Snowflake, otherwise the stage is useless
    # and this test would pass for the wrong reason.
    stage_statements = [
        sql for sql in snowflake_account.statements if "CREATE OR REPLACE STAGE" in sql
    ]
    assert len(stage_statements) == 1
    assert AWS_KEY_ID in stage_statements[0]
    assert AWS_SECRET in stage_statements[0]

    assert caplog.records
    for record in caplog.records:
        for credential in CREDENTIALS:
            assert credential not in record.getMessage()
    for credential in CREDENTIALS:
        assert credential not in caplog.text


def test_no_credential_is_logged_when_snowflake_rejects_the_copy(caplog, snowflake_account):
    snowflake_account.copy_error = snowflake.connector.errors.ProgrammingError(
        msg="Failure using stage area. Cause: [Access Denied (Status Code: 403)]",
        errno=91003,
        sqlstate="22000",
    )

    loader.main()

    errors = messages(caplog, logging.ERROR)
    assert len(errors) == 1
    assert "Access Denied" in errors[0]
    for credential in CREDENTIALS:
        assert credential not in caplog.text
    # The connection is closed even though the statement failed.
    assert [connection.closed for connection in snowflake_account.connections] == [True, True]


def test_logs_rows_loaded(caplog, snowflake_account):
    snowflake_account.copy_result = COPY_LOADED

    loader.main()

    loaded = [message for message in messages(caplog) if message.startswith("Loaded ")]
    assert loaded == [
        (
            f"Loaded 1 row(s) from {STAGED_FILE} into RAW_NBA_SCOREBOARD "
            "(status LOADED, 1 parsed, 0 error(s))."
        )
    ]
    assert messages(caplog, logging.WARNING) == []
    assert messages(caplog, logging.ERROR) == []
    assert not any("already loaded" in message for message in messages(caplog))


@pytest.mark.parametrize(
    ("copy_result", "reported"),
    [
        (COPY_NO_FILES, "Copy executed with 0 files processed."),
        (COPY_LOAD_SKIPPED, "LOAD_SKIPPED, File was loaded before."),
    ],
    ids=["no-files-processed", "load-skipped"],
)
def test_logs_already_loaded_when_copy_skips_the_file(
    caplog, snowflake_account, copy_result, reported
):
    snowflake_account.copy_result = copy_result

    loader.main()

    # The statements are the same as for a first load: the script leaves the
    # decision to COPY INTO instead of asking Snowflake beforehand.
    assert normalise(snowflake_account.statements[-1]) == COPY_SQL

    already_loaded = [message for message in messages(caplog) if "already loaded" in message]
    assert already_loaded == [
        (
            f"'{NEWEST_FILE}' was already loaded, so COPY INTO skipped it. "
            f"Snowflake reported: {reported}"
        )
    ]
    assert not any(message.startswith("Loaded ") for message in messages(caplog))
    assert messages(caplog, logging.WARNING) == []
    assert messages(caplog, logging.ERROR) == []


def test_warns_when_copy_reports_errors(caplog, snowflake_account):
    snowflake_account.copy_result = COPY_LOAD_FAILED

    loader.main()

    assert messages(caplog, logging.WARNING) == [
        (
            f"COPY INTO did not fully load {STAGED_FILE}: status LOAD_FAILED, "
            "1 parsed, 0 loaded, 1 error(s). First error: Error parsing JSON: unknown keyword"
        )
    ]
    assert not any(message.startswith("Loaded ") for message in messages(caplog))


def test_warns_when_copy_returns_no_result_rows(caplog, snowflake_account):
    snowflake_account.copy_result = COPY_NO_ROWS

    loader.main()

    assert messages(caplog, logging.WARNING) == [
        f"COPY INTO returned no result rows for '{NEWEST_FILE}'."
    ]
    assert not any(message.startswith("Loaded ") for message in messages(caplog))
    assert not any("already loaded" in message for message in messages(caplog))


def test_nothing_is_copied_when_the_bucket_has_no_files(caplog, s3, snowflake_account):
    s3.objects = []

    loader.main()

    assert [normalise(sql) for sql in snowflake_account.statements] == [
        SESSION_CONTEXT_SQL,
        CREATE_TABLE_SQL,
        SHOW_GRANTS_SQL,
    ]
    assert "No recent file found in S3 to load into Snowflake." in messages(caplog, logging.WARNING)


def test_snowflake_is_not_contacted_when_a_setting_is_missing(
    caplog, monkeypatch, snowflake_account
):
    monkeypatch.delenv("SNOWFLAKE_PASSWORD")

    loader.main()

    assert snowflake_account.connect_calls == []
    assert snowflake_account.statements == []
    assert messages(caplog, logging.ERROR) == [
        "Missing environment variables: SNOWFLAKE_PASSWORD",
        "Missing environment variables: SNOWFLAKE_PASSWORD",
    ]
