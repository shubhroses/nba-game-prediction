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
    Runs a dbt command to transform data. In this example, we run:
      dbt run --select my_first_dbt_model
    against your 'nba_dbt' project folder.
    Adjust the command or paths as needed.
    """
    # Path to your dbt project folder
    dbt_project_dir = os.getenv("DBT_PROJECT_DIR", "/path/to/nba_dbt")

    # Log the command we intend to run
    command = [
        "dbt",
        "run",
        "--select", "my_first_dbt_model",
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
    A Prefect flow that calls a dbt transformation to parse & transform data
    in your Snowflake (or other) environment.
    """
    run_dbt_transformation()

if __name__ == "__main__":
    transform_data_flow()
