# data_transformation/transform_data.py

import logging
import os
import sys
import subprocess
from dotenv import load_dotenv
from prefect import task, flow

# Configure Logging 
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Load environment variables from .env if desired
env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(dotenv_path=env_path)

@task
def run_dbt_transformation():
    """
    Builds the dbt project in the 'nba_dbt' folder:
      dbt build --project-dir $DBT_PROJECT_DIR
    'dbt build' creates the staging view stg_nba__games and the mart table
    fct_team_games and runs their schema tests in dependency order, so the
    mart is not rebuilt when a test on the staging model fails.
    """
    # Path to your dbt project folder
    dbt_project_dir = os.getenv("DBT_PROJECT_DIR", "/path/to/nba_dbt")

    # Log the command we intend to run
    command = [
        "dbt",
        "build",
        "--project-dir", dbt_project_dir
    ]
    logger.info(f"Running dbt command: {' '.join(command)}")

    try:
        # We capture output so we can log it
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            logger.info("dbt command succeeded.")
            logger.info(f"STDOUT:\n{result.stdout}")
        else:
            logger.error("dbt command failed.")
            logger.error(f"STDOUT:\n{result.stdout}")
            logger.error(f"STDERR:\n{result.stderr}")
            sys.exit(1)
    except FileNotFoundError:
        logger.error("Could not find 'dbt' executable. Is dbt installed and on your PATH?")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error running dbt: {e}")
        sys.exit(1)

@flow
def transform_data_flow():
    """
    A Prefect flow that runs dbt to turn the raw scoreboard JSON in Snowflake
    into the game and team-game models.
    """
    run_dbt_transformation()

if __name__ == "__main__":
    transform_data_flow()
