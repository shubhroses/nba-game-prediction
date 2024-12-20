# data_ingestion/fetch_nba_data.py

from prefect import task, flow
from nba_api.live.nba.endpoints import scoreboard
import boto3
import os
from datetime import datetime
import json
from dotenv import load_dotenv
import logging
import sys
from botocore.exceptions import NoCredentialsError, ClientError

# Load environment variables from .env file
load_dotenv()

# Configure logging to output to both the Prefect backend and the console
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)  # Adds console output
    ]
)
logger = logging.getLogger(__name__)

@task(retries=3, retry_delay_seconds=300, name="Fetch Live Scoreboard")
def fetch_live_scoreboard():
    """
    Fetches the live scoreboard data from the NBA API.
    """
    try:
        games = scoreboard.ScoreBoard()
        games_data = games.get_dict()  # Returns data as a dictionary
        logger.info("Successfully fetched live scoreboard data.")
        return games_data
    except Exception as e:
        logger.error(f"Error fetching data from NBA API: {e}")
        raise

@task(name="Print Data")
def print_data(data):
    """
    Logs the fetched NBA scoreboard data in a readable JSON format.
    """
    try:
        formatted_data = json.dumps(data, indent=2)
        logger.info("Fetched NBA Scoreboard Data:")
        logger.info(formatted_data)
        return data  # Return data for downstream tasks if needed
    except Exception as e:
        logger.error(f"Error logging data: {e}")
        raise

@task(retries=3, retry_delay_seconds=300, name="Save Data to S3")
def save_to_s3(data):
    """
    Saves the fetched data to AWS S3 in JSON format.
    """
    try:
        # Initialize S3 client
        s3 = boto3.client(
            's3',
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION", "us-east-1")  # Default to us-east-1 if not specified
        )
        
        bucket_name = os.getenv("S3_BUCKET_NAME")
        if not bucket_name:
            raise ValueError("S3_BUCKET_NAME not found in environment variables.")
        
        # Generate a unique file name based on the current timestamp
        file_name = f"nba_scoreboard_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        # Convert the data dictionary to a JSON string
        json_data = json.dumps(data)
        
        # Upload the JSON data to S3
        s3.put_object(Bucket=bucket_name, Key=f"raw/{file_name}", Body=json_data)
        
        logger.info(f"Data successfully saved to s3://{bucket_name}/raw/{file_name}")
        return file_name
    except NoCredentialsError:
        logger.error("AWS credentials not available.")
        raise
    except ClientError as e:
        logger.error(f"Client error while saving data to S3: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error while saving data to S3: {e}")
        raise

@flow(name="Fetch NBA Live Scoreboard, Print, and Save to S3")
def nba_data_flow():
    """
    Prefect flow to fetch NBA live scoreboard data, print it, and save it to AWS S3.
    """
    games_data = fetch_live_scoreboard()
    printed_data = print_data(games_data)
    file_name = save_to_s3(printed_data)

if __name__ == "__main__":
    nba_data_flow()
