import os
import sys
import logging
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv
import snowflake.connector

# -----------------------------------------------------------------------------
# Configure Logging
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s', 
)
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Load Environment Variables
# -----------------------------------------------------------------------------
env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(dotenv_path=env_path)

def debug_log_env_vars():
    """
    Log relevant environment variables (excluding passwords/secrets).
    """
    user = os.getenv("SNOWFLAKE_USER")
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    role = os.getenv("SNOWFLAKE_ROLE")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE")
    schema = os.getenv("SNOWFLAKE_SCHEMA")
    bucket_name = os.getenv("S3_BUCKET_NAME")
    logger.info("==== Debug: Environment Variables (Sanitized) ====")
    logger.info(f"SNOWFLAKE_USER: {user}")
    logger.info(f"SNOWFLAKE_ACCOUNT: {account}")
    logger.info(f"SNOWFLAKE_ROLE: {role}")
    logger.info(f"SNOWFLAKE_WAREHOUSE: {warehouse}")
    logger.info(f"SNOWFLAKE_DATABASE: {database}")
    logger.info(f"SNOWFLAKE_SCHEMA: {schema}")
    logger.info(f"S3_BUCKET_NAME: {bucket_name}")
    logger.info("==================================================")

def debug_log_current_context(cs):
    """
    Logs the current session info for debugging: user, role, warehouse, db, schema.
    """
    try:
        cs.execute("SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA()")
        row = cs.fetchone()
        if row:
            current_user, current_role, current_wh, current_db, current_schema = row
            logger.info("==== Debug: Current Snowflake Session Context ====")
            logger.info(f"CURRENT_USER: {current_user}")
            logger.info(f"CURRENT_ROLE: {current_role}")
            logger.info(f"CURRENT_WAREHOUSE: {current_wh}")
            logger.info(f"CURRENT_DATABASE: {current_db}")
            logger.info(f"CURRENT_SCHEMA: {current_schema}")
            logger.info("===================================================")
    except Exception as ex:
        logger.error(f"Error retrieving current session context: {ex}")

def get_most_recent_s3_file(prefix="raw/") -> str:
    """
    Returns the key of the most recently modified file in the S3 bucket under 'prefix'.
    If no files exist, returns None.
    """
    bucket_name = os.getenv("S3_BUCKET_NAME")
    if not bucket_name:
        logger.error("S3_BUCKET_NAME not set in environment variables.")
        return None

    try:
        s3 = boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION", "us-east-1")
        )
        response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        contents = response.get("Contents", [])
        if not contents:
            logger.warning(f"No S3 objects found in bucket '{bucket_name}' with prefix '{prefix}'")
            return None

        # Find the most recent object
        most_recent = max(contents, key=lambda obj: obj["LastModified"])
        return most_recent["Key"]  # e.g. "raw/nba_scoreboard_20241230_194424.json"
    except NoCredentialsError:
        logger.error("AWS credentials not available.")
    except ClientError as e:
        logger.error(f"Error listing S3 objects: {e}")
    except Exception as e:
        logger.error(f"Unexpected error listing S3 objects: {e}")

    return None

def create_table_if_not_exists():
    """
    Connect to Snowflake using role/warehouse/db/schema specified in .env,
    then create RAW_NBA_SCOREBOARD if it doesn't exist.
    """
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    role = os.getenv("SNOWFLAKE_ROLE")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE")
    schema = os.getenv("SNOWFLAKE_SCHEMA")

    missing_vars = [
        var for var, val in {
            "SNOWFLAKE_USER": user,
            "SNOWFLAKE_PASSWORD": password,
            "SNOWFLAKE_ACCOUNT": account,
            "SNOWFLAKE_ROLE": role,
            "SNOWFLAKE_WAREHOUSE": warehouse,
            "SNOWFLAKE_DATABASE": database,
            "SNOWFLAKE_SCHEMA": schema
        }.items() if not val
    ]
    if missing_vars:
        logger.error(f"Missing environment variables: {', '.join(missing_vars)}")
        return

    logger.info("Creating table if not exists. Connecting to Snowflake now...")

    try:
        conn = snowflake.connector.connect(
            user=user,
            password=password,
            account=account,
            role=role,
            warehouse=warehouse,
            database=database,
            schema=schema
        )
        cs = conn.cursor()
        try:
            # Log session context
            debug_log_current_context(cs)

            create_table_sql = """
                CREATE TABLE IF NOT EXISTS RAW_NBA_SCOREBOARD (
                    game_data VARIANT
                )
            """
            logger.info(f"Executing SQL:\n{create_table_sql}")
            cs.execute(create_table_sql)
            logger.info('Table "RAW_NBA_SCOREBOARD" is set up (or already exists).')

            # Log the grants on this table
            check_grants_sql = "SHOW GRANTS ON TABLE RAW_NBA_SCOREBOARD"
            logger.info(f"Checking privileges on RAW_NBA_SCOREBOARD:\n{check_grants_sql}")
            cs.execute(check_grants_sql)
            grants = cs.fetchall()
            logger.info("==== Debug: Grants on RAW_NBA_SCOREBOARD ====")
            for g in grants:
                logger.info(str(g))
            logger.info("=============================================")

        finally:
            cs.close()
            conn.close()
    except snowflake.connector.errors.Error as e:
        logger.error(f"Snowflake error in create_table_if_not_exists: {e}")

def log_copy_result(cs, file_name: str) -> None:
    """
    Logs what the COPY INTO statement that 'cs' has just executed did with
    'file_name': how many rows it loaded, or that the file was already loaded.

    For each file it handles, COPY INTO returns a row with the columns FILE,
    STATUS, ROWS_PARSED, ROWS_LOADED, ERROR_LIMIT, ERRORS_SEEN and FIRST_ERROR,
    plus three columns that locate the first error. When it loads nothing it
    returns a single row that holds only a status message ("Copy executed with
    0 files processed."). A file that is already in the table's load metadata
    is not loaded again and comes back in that form, or as a file row with the
    status LOAD_SKIPPED.

    Snowflake keeps load metadata for 64 days. It also skips a file older than
    that when it can no longer tell whether the file was loaded, and reports
    it the same way.
    """
    columns = [column[0].lower() for column in cs.description or []]
    results = [dict(zip(columns, row)) for row in cs.fetchall()]
    if not results:
        logger.warning(f"COPY INTO returned no result rows for '{file_name}'.")

    for result in results:
        status = str(result.get("status"))
        # A row without ROWS_LOADED is the status message on its own.
        if "rows_loaded" not in result or status.upper() == "LOAD_SKIPPED":
            reported = ", ".join(
                str(part) for part in (result.get("status"), result.get("first_error")) if part
            )
            logger.info(
                f"'{file_name}' was already loaded, so COPY INTO skipped it. "
                f"Snowflake reported: {reported}"
            )
        elif status.upper() == "LOADED":
            logger.info(
                f"Loaded {result.get('rows_loaded')} row(s) from {result.get('file')} "
                f"into RAW_NBA_SCOREBOARD (status {status}, "
                f"{result.get('rows_parsed')} parsed, {result.get('errors_seen')} error(s))."
            )
        else:
            logger.warning(
                f"COPY INTO did not fully load {result.get('file')}: status {status}, "
                f"{result.get('rows_parsed')} parsed, {result.get('rows_loaded')} loaded, "
                f"{result.get('errors_seen')} error(s). First error: {result.get('first_error')}"
            )

def load_json_data_from_s3_to_snowflake():
    """
    Finds the most recent file in s3://{bucket_name}/raw/ and runs COPY INTO
    RAW_NBA_SCOREBOARD for it. Snowflake skips the file if it has already
    loaded it into the table.
    """
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    role = os.getenv("SNOWFLAKE_ROLE")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE")
    schema = os.getenv("SNOWFLAKE_SCHEMA")
    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")
    bucket_name = os.getenv("S3_BUCKET_NAME")

    # 1) Find the most recent file in the S3 bucket
    most_recent_key = get_most_recent_s3_file(prefix="raw/")
    if not most_recent_key:
        logger.warning("No recent file found in S3 to load into Snowflake.")
        return
    file_name = os.path.basename(most_recent_key)
    logger.info(f"Most recent file in S3 bucket: {most_recent_key}  -> We'll copy '{file_name}'")

    missing_vars = []
    for var, val in [
        ("SNOWFLAKE_USER", user),
        ("SNOWFLAKE_PASSWORD", password),
        ("SNOWFLAKE_ACCOUNT", account),
        ("SNOWFLAKE_ROLE", role),
        ("SNOWFLAKE_WAREHOUSE", warehouse),
        ("SNOWFLAKE_DATABASE", database),
        ("SNOWFLAKE_SCHEMA", schema),
        ("AWS_ACCESS_KEY_ID", aws_key),
        ("AWS_SECRET_ACCESS_KEY", aws_secret),
        ("S3_BUCKET_NAME", bucket_name)
    ]:
        if not val:
            missing_vars.append(var)
    if missing_vars:
        logger.error(f"Missing environment variables: {', '.join(missing_vars)}")
        return

    logger.info("Loading JSON data from S3 to Snowflake. Connecting now...")
    try:
        conn = snowflake.connector.connect(
            user=user,
            password=password,
            account=account,
            role=role,
            warehouse=warehouse,
            database=database,
            schema=schema
        )
        cs = conn.cursor()
        try:
            # Log current session context
            debug_log_current_context(cs)

            # 2) Create or replace the stage
            create_stage_template = """
                CREATE OR REPLACE STAGE nba_stage
                URL='s3://{bucket_name}/raw/'
                CREDENTIALS=(
                    AWS_KEY_ID='{aws_key}'
                    AWS_SECRET_KEY='{aws_secret}'
                )
                FILE_FORMAT=(TYPE=JSON)
            """
            create_stage_sql = create_stage_template.format(
                bucket_name=bucket_name, aws_key=aws_key, aws_secret=aws_secret
            )
            # Log the statement with the AWS key pair masked. The real values
            # are sent to Snowflake only and must not reach the log.
            redacted_stage_sql = create_stage_template.format(
                bucket_name=bucket_name, aws_key="****", aws_secret="****"
            )
            logger.info(f"Executing SQL:\n{redacted_stage_sql}")
            cs.execute(create_stage_sql)
            logger.info("Stage 'nba_stage' created or replaced.")

            # 3) COPY INTO. Whether the file is already in the table is left to
            # Snowflake: unless FORCE = TRUE is given, COPY INTO skips a staged
            # file it has already loaded into the table, going by the load
            # metadata it keeps on the table for 64 days.
            copy_sql = f"""
                COPY INTO RAW_NBA_SCOREBOARD
                FROM @nba_stage/{file_name}
                FILE_FORMAT=(TYPE=JSON)
                ON_ERROR='CONTINUE'
            """
            logger.info(f"Executing SQL:\n{copy_sql}")
            cs.execute(copy_sql)
            log_copy_result(cs, file_name)

        finally:
            cs.close()
            conn.close()
    except snowflake.connector.errors.Error as e:
        logger.error(f"Snowflake error while copying data: {e}")

def main():
    # 0) Log environment variables
    debug_log_env_vars()

    # 1) Create the table if it doesn't exist
    create_table_if_not_exists()

    # 2) Load the most recent file from S3
    load_json_data_from_s3_to_snowflake()

if __name__ == "__main__":
    main()
