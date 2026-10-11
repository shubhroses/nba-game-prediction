# nba-game-prediction

A work-in-progress NBA data project with four parts:

1. A small ingestion pipeline. A Prefect flow pulls the live NBA scoreboard and lands the raw JSON in S3, a script loads the newest file into Snowflake, and a second Prefect flow runs dbt, which turns the JSON into one row per game and one row per team per game.
2. Two notebooks that train baseline win/loss classifiers on historical game data.
3. A React app that shows, for each upcoming game, the chance that each of two models gives either team, with the sportsbooks' number beside it, and how the picks of the models and of the sportsbooks have done. It reads what part 4 publishes.
4. A scheduled job that records, six times a day, the win probability that US sportsbooks' prices imply for each upcoming game, and once a day the final scores of the games that are over and whether the sportsbooks' favorite won. The same daily run forecasts the games of the day with two models of its own, Elo and a points-and-rest model, and grades their forecasts as it grades the sportsbooks'. It commits all of it to the `data` branch of this repository.

Only two of the parts are wired together: the web app shows what the scheduled job publishes, which is the latest odds snapshot, the forecasts of the job's two models, and the record of both against the sportsbooks. Nothing reads the dbt models, the notebooks read their own data, and nothing of the notebooks' models reaches the web app. The dbt models are tested on a local emulator and have not been run against Snowflake. See [Known gaps](#known-gaps).

Web app demo: https://nba-predictions-app.vercel.app

## Repository layout

| Path | What it is |
| --- | --- |
| `data_ingestion/fetch_nba_data.py` | Prefect flow. Fetches today's live scoreboard with `nba_api`, logs it at INFO level, and writes it to `s3://$S3_BUCKET_NAME/raw/nba_scoreboard_<YYYYMMDD_HHMMSS>.json`. The fetch and upload tasks retry three times, five minutes apart. |
| `data_ingestion/move_nba_data_to_sf.py` | Plain Python script. Creates the table `RAW_NBA_SCOREBOARD (game_data VARIANT)` if it does not exist, finds the most recently modified object under `raw/` in the bucket, creates or replaces an external stage `nba_stage` on `s3://$S3_BUCKET_NAME/raw/` with the AWS key pair from `.env`, and runs `COPY INTO` for that one file. The stage statement is logged with the key pair masked. The result of the `COPY INTO` is logged too: the rows loaded, or that Snowflake skipped the file because it was already loaded. |
| `data_transformation/transform_data.py` | Prefect flow that shells out to `dbt build --project-dir $DBT_PROJECT_DIR`, which builds both dbt models and runs their schema tests. It logs dbt's output (at INFO level when dbt succeeds, at ERROR level when it fails) and exits with status 1 if dbt fails, which includes a failing test. |
| `nba_dbt/` | dbt project for Snowflake, with its own [README](nba_dbt/README.md). A source for `RAW_NBA_SCOREBOARD`, a staging view `stg_nba__games` with one row per game, a mart table `fct_team_games` with one row per team per game, and schema tests on both. `nba_dbt/ci/profiles.yml` is a placeholder profile for checks that do not connect. |
| `notebooks/predict_past.ipynb` | Season-by-season backtest of a ridge classifier on historical team box scores. |
| `notebooks/predict_live.ipynb` | Exploratory notebook: random forest on game logs pulled from `nba_api`, then predictions for today's and tomorrow's schedule. |
| `nba-predictions-app/` | React 19 + Vite + Tailwind CSS frontend in TypeScript, with its own [README](nba-predictions-app/README.md). It reads four kinds of file from the `data` branch: the board, the record, the ratings of the two models and the forecasts of a day. `sample-data/` holds the same files for an invented season in progress, which the app's tests and a preview read. Its `vercel.json` holds the build settings and the response headers of the deployment. |
| `pipeline/` | Python package for the odds snapshots, the results and the forecasts, standard library only, with its own [README](pipeline/README.md). `python -m pipeline snapshot` asks The Odds API for the upcoming games, works out the sportsbooks' consensus for each one and writes three files: the board, a state file and the day's history. Once a day it first asks for the scores of the last three days, writes a result line for each game that is over, graded against the game's last line from before the start and against what its two models said that morning, rebuilds the record and the models, and freezes the models' forecasts for the games of the day. |
| `pipeline/model/` | The two models, with their own [README](pipeline/model/README.md): Elo ratings kept the way FiveThirtyEight kept them, and a points-and-rest model that rates every team in points and adds terms for home court and rest. Both use the schedule and final scores only. The two JSON files hold what a season starts them from. |
| `tests/` | pytest tests for the load script, the transformation flow, the dbt models and the odds pipeline with its two models, described under [Tests and CI](#tests-and-ci). `tests/fake_odds_api.py` is a local stand-in for The Odds API. `tests/sample_season.py` plays an invented stretch of the season through the job, which is how the web app's sample data is written. `tests/fixtures/` holds, among other things, one season of FiveThirtyEight's published NBA Elo ratings, with a note on its source and license. `pytest.ini` puts the repository root and the two script directories on the import path. |
| `.github/workflows/ci.yml` | GitHub Actions workflow with three jobs: the Python tests, `dbt parse` and `dbt compile`, and the web app's lint, type check, unit tests and build, with two checks of the built files. |
| `.github/workflows/pipeline.yml` | GitHub Actions workflow `Odds snapshot`. It runs `pipeline/` on a schedule and commits the output, snapshots, results and forecasts, to the `data` branch. |
| `.github/data-branch/` | The two files the workflow puts into the `data` branch when it creates it: the branch's README, and a `vercel.json` that tells Vercel not to deploy that branch. |
| `requirements.txt` | The Python packages the scripts and notebooks import, plus `dbt-snowflake` for the `dbt` command. |
| `requirements-dev.txt` | `pytest` and `fakesnow`, which only the tests need. |
| `prefect.yaml` | Generated by `prefect init` (Prefect 3.1.5). No deployments are defined yet; the flows are run directly. |

## Ingestion pipeline

```
NBA live scoreboard (nba_api)
        |   data_ingestion/fetch_nba_data.py        (Prefect flow)
        v
S3      s3://<bucket>/raw/nba_scoreboard_<timestamp>.json
        |   data_ingestion/move_nba_data_to_sf.py   (stage + COPY INTO)
        v
Snowflake   RAW_NBA_SCOREBOARD     table, one VARIANT column, one row per file
        |   data_transformation/transform_data.py   (Prefect flow -> dbt build)
        v
dbt         stg_nba__games         view, one row per game
        |
        v
            fct_team_games         table, one row per team per game
```

All three scripts read their settings from a `.env` file in the repository root (it is git-ignored).

What each step leaves behind:

- **S3:** one JSON file per run of the ingestion flow, holding the scoreboard as `nba_api` returned it.
- **`RAW_NBA_SCOREBOARD`:** one row per file. Snowflake skips a file that `COPY INTO` has already loaded (see [Known gaps](#known-gaps)), but the ingestion flow can run several times a day, so a game is usually in more than one row.
- **`stg_nba__games`:** one row per game: game id, date, status, and the id, three-letter code and score of the home and away team. Of all the snapshots of a game, the one in which the game is furthest along is kept.
- **`fct_team_games`:** two rows per game, one from each team's side, with points for and against, a home/away flag and a `won` flag that is set only when the game is finished.

The models, their columns and their tests are described in [`nba_dbt/README.md`](nba_dbt/README.md).

## Notebooks

### `predict_past.ipynb`

Predicts whether a team wins its next game from box-score statistics.

- Input: `nba_games.csv` in the repository root. The file is not included in the repo (it is git-ignored). In the saved run it has 17,772 team-game rows and 150 columns covering 27 October 2015 to 16 June 2022. Those figures are the same as in Dataquest's own notebook (see below), whose README links the CSV it uses: team box scores scraped from Basketball Reference.
- Target: the `won` value of the same team's next game.
- Model: `RidgeClassifier` on min-max scaled features, with 30 features chosen by forward `SequentialFeatureSelector` using a three-fold `TimeSeriesSplit`.
- Evaluation: a backtest that, for each season from the third one onward, trains on all earlier seasons and predicts that season.

Results stored in the notebook output:

| Features | Backtest accuracy |
| --- | --- |
| Previous game's box score only | 54.9% |
| Plus 10-game rolling averages for the team and its next opponent, and the next game's home/away flag | 63.2% |

For reference, the home team wins 57.2% of the games in the same data, so the first model is worse than always picking the home team and the second is about six points better. The scaler and the feature selector are both fit on the whole dataset before the backtest runs, so the seasons used for testing also influence which features are chosen. Read the accuracy figures with that in mind.

This notebook follows Dataquest's NBA game prediction project walkthrough, [`nba_games/predict.ipynb` in dataquestio/project-walkthroughs](https://github.com/dataquestio/project-walkthroughs/tree/master/nba_games). The helper functions (`add_target`, `backtest`, `find_team_averages`, `shift_col`, `add_col`), the model settings and the backtest are the walkthrough's. The main changes here are explanatory markdown cells, a few extra print cells, a `find_team_averages` that drops non-numeric columns before taking the rolling mean, and two closing cells that fetch the live scoreboard with `nba_api` without predicting anything from it.

### `predict_live.ipynb`

Pulls every team's game log with `nba_api`'s `LeagueGameFinder`, trains a `RandomForestClassifier` on five features (team, opponent, the team's average points per game, a home/away flag and a last-game-result flag), and then scores the games returned by `ScoreboardV2` for today and tomorrow. The saved run reports 58.9% accuracy on a random 80/20 split. Treat that number as indicative only: the split is not time-ordered, and the points-per-game feature is an average over each team's whole history. The final cell that scores upcoming games looks team statistics up by raw NBA team id after that column has been label-encoded, so it falls back to default values; its printed probabilities are not meaningful forecasts.

## Web app (`nba-predictions-app/`)

The app reads the files that the job in the next section publishes on the `data` branch: the board, [`v1/slate.json`](https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1/slate.json), which is replaced at every snapshot, and the record, the ratings of the two models and the forecasts of the day, which are written once a day. It sends no request to The Odds API, and its build holds no key. It makes no forecast: the two models run in the job, and the page shows what they said. It does not use the models from the notebooks.

The page has five views:

- **Games.** One card for each game to come, a day at a time. A card leads with each team's chance of winning by the points-and-rest model once that is made on the morning of the game, and by Elo before that. Under it stand all three sources, the two models and the sportsbooks, each with its pick. A side that a source puts at 52% or more is its pick, and between 48% and 52% the card says toss-up. A game without a line or without a forecast says so and shows no number in its place.
- **Results.** The games of the last eight days that are over, with what each source had said and whether its pick won.
- **Record.** The picks won and lost of each source with a 95% interval, each model next to the sportsbooks, calibration, the days and the biggest upsets. Before the first game of the season it says when the record starts, and shows the backtest of the two models under a label that says it is not a result of this season.
- **Rankings.** Every team's rating in both models, and a calculator that works out Elo's chance for any two teams from the published ratings.
- **How it works.** The two models in plain words and with their formulas, how a forecast is frozen and graded, and what the backtest does and does not show.

Other behavior, as implemented in `src/`:

- A status line under the tabs gives the time and the age of the snapshot and says when the next one is due.
- The page checks for a newer board every five minutes while its tab is visible, and asks for the other files again when the board is newer. A file that arrives from an earlier run of the job than the board, which the host's cache can cause in the minutes after a run, is asked for again with every check until the two go together. If such a check fails, what is on screen stays. If a file cannot be loaded, the page shows one sentence that says why and a Try again button. How it works reads no file and is shown all the same.
- A visitor can follow teams. They are kept in the browser's storage and nowhere else.
- The page has a light and a dark theme, which follows the visitor's system.
- The deployment sends a Content-Security-Policy that lets the page reach its own origin, `raw.githubusercontent.com` for the files and `cdn.nba.com` for the logos, and nothing else.

The regular season starts on 20 October 2026. As of 10 October 2026 the real files hold Elo's chance for the scheduled games and the opening ratings, and no result, no graded pick and no frozen forecast, and each view says so. What the views show of a season in progress has been looked at with the invented season in `nba-predictions-app/sample-data` only.

Details are in [`nba-predictions-app/README.md`](nba-predictions-app/README.md).

## Odds snapshots, results and forecasts (`pipeline/`)

A snapshot of the odds says what the sportsbooks say now. Comparing a prediction with the sportsbooks after a game needs the line from before the game and the result of the game. The free plan of The Odds API has no historical data, and its scores reach back three days. This job keeps both from now on, and it grades the sportsbooks themselves: for each game that is over it records whether the side they favored won. It also makes the predictions that are compared with them: two models forecast every game on the morning it is played, and each forecast is on record before the game and graded after it.

`.github/workflows/pipeline.yml` is triggered twice an hour. Six times a day, at fixed New York times, a run finds a snapshot due and makes one request for the upcoming games. Every other run stops before it makes a request, so the spare triggers cost no API credits; they are there because GitHub may start a scheduled run late, and because a run can fail. For each game that has not started, the job takes every US sportsbook that quotes both teams, removes that sportsbook's margin from its prices, and records the median home win probability together with the lowest, the highest and the number of sportsbooks.

The first slot of the day, at 05:10 in New York, also does the daily work, before its snapshot: one request for the scores of the last three days, and a result line for every game that is over and not yet recorded. A game is graded against its last line from before the start. The line favors the side it puts at 52% or more, and between 48% and 52% the game is a toss-up that counts neither as a win nor as a loss. The record is then rebuilt from all result lines: the favorite's wins and losses, the accuracy with a Wilson 95% interval, the Brier score and the log loss of the lines, what the home team every time would have won, the results by band of the favorite's probability and by day, and the three biggest upsets.

The same daily run then turns to the two models in [`pipeline/model/`](pipeline/model/README.md), for the regular season only. Elo is FiveThirtyEight's method with a home court of 40 points: one rating for each team, moved after every game by the result and its margin. The points-and-rest model rates every team in points, knows how well it knows each rating, and adds terms for home court, for a team that played the day before, for the games of the last seven days, for altitude and for the playoffs. Both use the schedule and final scores and nothing else. Every morning both are replayed from the opening of the season through every result recorded so far, so a morning that was missed repairs itself. Their forecasts for the games of that day are written to a file of the day, once, and that file is never changed afterwards: a forecast can be held against its game because it was on record before the game started. When a game is over, its result line gets what each model had said, with a verdict by the same rule as the sportsbooks' line, and the record gives each model what it gives the sportsbooks, the games in which a model and the sportsbooks picked different winners, and the difference between their Brier scores with an interval. Before the replay is trusted, the results are checked for a game recorded twice, a team with two results on one day and a game without a result. If a check fails, Elo is published alone that day and the model file says why.

The two models were chosen in a backtest on 28,382 games of 22 seasons, which is described in [`pipeline/model/README.md`](pipeline/model/README.md#how-the-two-were-chosen). On the 2,643 games of 2024-25 and 2025-26, the two seasons that were kept for the test, Elo picked 66.7% of the winners and the points-and-rest model 67.6%, a gap that is within what chance produces: it is not shown that one picks more winners than the other. The points-and-rest model's percentages scored slightly better, with a log loss of 0.6031 against 0.6065, and that difference showed in one of the two seasons. Neither model was tested against the sportsbooks. The record on the `data` branch, from opening night on 20 October 2026, is where that comparison is made.

The free plan of The Odds API allows 500 credits a month. An odds request costs one and a scores request two. The plan is 6 odds requests and one scores request a day for each sport, which is 8 credits: 248 in a 31-day month for the regular season, plus the preseason rehearsal described below. When a snapshot or the daily work fails, the next trigger asks again, but only a run that starts within 75 minutes of the slot's start may ask, and a run never repeats a request. Three triggers fall in those 75 minutes, so while a failure lasts the schedule asks 3 times for a slot and 18 times a day for the odds of each sport, and 3 times a day for its scores, however the run fails. Any other run that starts in those 75 minutes asks once more: one that is started by hand, or the trigger before the slot if GitHub starts it more than half an hour late. After that the slot is given up and stays empty. Daily work that was given up is made up for by the next morning's run, from the same three days of scores.

Each snapshot is one commit on the `data` branch, with three files:

- `v1/slate.json`: the upcoming games, each with its line in this snapshot, its opening line, Elo's chance and, for a game of the day, the frozen forecast of the points-and-rest model. With them the wins and losses so far of the sportsbooks' favorite and of each model's, and the results of the last eight days.
- `v1/state.json`: what the job remembers between runs, including each game's last line from before its start, kept for 14 days.
- `v1/history/<date>.ndjson`: one line per game per snapshot. Lines are only ever added.

The commit of the daily work, which is normally the same commit as the 05:10 snapshot, has four more:

- `v1/results/<month>.ndjson`: one line per game that is over, with the final score, the line it was graded against and the verdict, and each model's forecast with the verdict on it. Lines are only ever added, and a game is recorded once.
- `v1/predictions/<date>.json`: the two models' forecasts for the games of that day, written once and never changed.
- `v1/model.json`: every team's ratings in both models, its wins and losses, and whether both models could be built that day.
- `v1/record.json`: what the results add up to, for the sportsbooks and for each model, rebuilt from all of them.

Of the odds, the files hold derived values only, no prices. No sportsbook is named next to a number of its own: a game that only one sportsbook quotes, or on which all of them give the same probability, is recorded without names. Of the scores, the files hold the final score of each game that is over. The API key is a repository secret that is passed to the one step that makes the requests. Until 17 October 2026 the job also records preseason games under `v1-dryrun/`, results included, as a rehearsal. The models are not run on those. The two sports are taken one after the other, and one that fails does not keep the other from being recorded. Neither does the daily work keep the snapshot from being taken when the scores cannot be had, or the reverse, and a fault in the models does not keep the results of the night from being recorded.

The file formats, the grading rules, the schedule, the credit budget, the exit codes and what has and has not been checked are in [`pipeline/README.md`](pipeline/README.md). The two models, where their numbers come from and what they cannot know are in [`pipeline/model/README.md`](pipeline/model/README.md).

## Running it

### Ingestion pipeline

Requires Python 3, an AWS account with an S3 bucket, and a Snowflake account. The project was developed in a Python 3.9 virtualenv. `requirements.txt` does not pin versions, apart from capping pandas below 3 for the notebooks. A clean install of it was last checked on Python 3.12 in October 2026, and the CI workflow repeats that install on every push.

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create `.env` in the repository root:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET_NAME=...

SNOWFLAKE_USER=...
SNOWFLAKE_PASSWORD=...
SNOWFLAKE_ACCOUNT=...
SNOWFLAKE_ROLE=...
SNOWFLAKE_WAREHOUSE=...
SNOWFLAKE_DATABASE=...
SNOWFLAKE_SCHEMA=...

DBT_PROJECT_DIR=/absolute/path/to/nba-game-prediction/nba_dbt
```

`AWS_REGION` is optional and defaults to `us-east-1`. Then run the steps in order:

```bash
python data_ingestion/fetch_nba_data.py
python data_ingestion/move_nba_data_to_sf.py
python data_transformation/transform_data.py
```

With no Prefect API configured, Prefect 3 starts a temporary local server for the duration of each flow run.

The two flows write most of their own messages at INFO level through Python's `logging` module: the scoreboard JSON in the ingestion flow, and the dbt command and its output when dbt succeeds. Importing Prefect puts its own handler on the root logger at WARNING level, which turns the scripts' later `logging.basicConfig(level=logging.INFO, ...)` call into a no-op. By default, then, those lines are not printed; only Prefect's own lines and the scripts' ERROR lines are. Set `PREFECT_LOGGING_ROOT_LEVEL=INFO` to see them (other libraries' INFO lines are printed too). This was checked with Prefect 3.8.8. `move_nba_data_to_sf.py` does not import Prefect, so its INFO lines are always printed.

The second step ends by logging what `COPY INTO` did with the file. Normally the line has one of these two forms, the second when the file is already in the table and Snowflake skips it:

```
Loaded 1 row(s) from s3://<bucket>/raw/nba_scoreboard_<timestamp>.json into RAW_NBA_SCOREBOARD (status LOADED, 1 parsed, 0 error(s)).
'nba_scoreboard_<timestamp>.json' was already loaded, so COPY INTO skipped it. Snowflake reported: Copy executed with 0 files processed.
```

Both lines are taken from the unit tests, which use a fake connection. Any other status in the result, such as a failed or partial load, is logged as a WARNING with the first error instead. The script has not been run against Snowflake since this logging was added (see [Known gaps](#known-gaps)).

The dbt step additionally needs one thing that is not in this repository: a dbt profile named `nba_dbt`, for example in `~/.dbt/profiles.yml`. [`nba_dbt/README.md`](nba_dbt/README.md#running) shows a profile that reads the `SNOWFLAKE_*` variables above. The flow loads `.env` before it starts dbt, so the variables are set when dbt reads the profile. `dbt build` then creates `stg_nba__games` and `fct_team_games` in the profile's database and schema and runs their schema tests.

### Notebooks

`requirements.txt` covers what the notebooks import (`pandas`, `numpy`, `scikit-learn`, `matplotlib`, `seaborn`, `shap` and `nba_api`). Jupyter itself is not listed; install it separately, for example with `pip install notebook`.

pandas is capped below 3 because `predict_past.ipynb` relies on pandas 2 behaviour: on pandas 3 its first `groupby(...).apply(...)` drops the `team` column and the next cell fails.

`predict_past.ipynb` needs `nba_games.csv` in the repository root; `predict_live.ipynb` downloads its data from the NBA stats API when it runs.

### Web app

Requires Node.js 20.19 or later, 22.13 or later, or 24 and later (the range the app's lint and test tools accept). No API key is needed.

```bash
cd nba-predictions-app
npm ci
npm run dev
```

The development server shows the files that are published on the `data` branch. [`nba-predictions-app/README.md`](nba-predictions-app/README.md#the-sample-data) says how to look at the page with the sample data of an invented season. Other scripts in `package.json`: `npm run build` (the type check, then the build), `npm run typecheck`, `npm run lint`, `npm test` and `npm run preview`.

### Odds snapshots, results and forecasts

Requires Python 3.11 or newer and no packages. No key is needed to try it: `tests/fake_odds_api.py` serves invented games, prices and scores in the shape of the real responses.

```bash
python tests/fake_odds_api.py --port 8765 &
export ODDS_API_BASE_URL=http://127.0.0.1:8765 ODDS_API_KEY=any-value
python -m pipeline snapshot --all --data-dir /tmp/odds-data --force
```

The command writes its files under `/tmp/odds-data/`: the results of the games that the fake server lists as over, the record, the model file with every team's ratings, and the snapshot. No game is forecast in this one run, because the daily work comes before the first snapshot and knows no game yet. The tests in `tests/test_pipeline_forecasting.py` run the command through the mornings of a week, with forecasts that are frozen and then graded. It is forced because, without `--force`, a run takes a snapshot only in the first 75 minutes of a slot, and does the daily work only in the first 75 minutes of the 05:10 slot. Run again without `--force` within the same slot, it prints `Not due` and makes no request. [`pipeline/README.md`](pipeline/README.md#running-it) lists the options.

## Tests and CI

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest
```

The tests need no AWS or Snowflake account, no API key and no credentials.

| File | What it does |
| --- | --- |
| `tests/test_move_nba_data_to_sf.py` | Runs the load script's `main()` against a fake S3 client and a fake Snowflake connection. It asserts the statements sent to Snowflake, in order, that the `COPY INTO` carries no `FORCE` option, what is logged for each kind of `COPY INTO` result, and that neither the AWS key pair nor the Snowflake password appears in any log record. |
| `tests/test_transform_data.py` | Calls the flow's task function with `subprocess.run` replaced by a fake. It asserts the dbt command and the exit status when dbt fails or is not installed. |
| `tests/test_dbt_models.py` | Builds the dbt project against [fakesnow](https://github.com/tekumara/fakesnow), a local emulator that translates Snowflake SQL to DuckDB, by calling the flow's task function with the real `dbt`. It then compares every row of both models with the rows expected for a set of scoreboard responses. Skipped when fakesnow is not installed. |
| `tests/test_pipeline_*.py` | The odds pipeline, its two models and its workflow file; [`pipeline/README.md`](pipeline/README.md#tests) and [`pipeline/model/README.md`](pipeline/model/README.md#tests) list the files. The end-to-end tests run the command against `tests/fake_odds_api.py` on `127.0.0.1` with invented prices and scores and a dummy key: a first run, a second run in the same slot that must make no request, refusals and outages, a validation failure that must leave the files untouched, one sport failing while the other is written, and for the daily work an evening of lines and the morning after it, with the scores failing while the snapshot is taken and the reverse. For the models they run the mornings of a week: forecasts frozen on the morning of a game and graded the morning after, a file of forecasts that no later run changes, a missing result that leaves Elo published alone, and a morning that was missed and repairs itself. After every run they check that the key is in nothing the command printed or wrote. The grading rules and the record's arithmetic are tested against figures worked out by hand. The Elo rule is held to the 1,320 games of one season of FiveThirtyEight's published ratings, and the points-and-rest model to the expected values that its reference implementation came with. `tests/test_pipeline_credits.py` walks all the triggers of a day through the command for each way a run can fail and counts the requests: at most 3 for a slot and 18 a day for the odds of each sport, and at most 3 a day for its scores. |
| `tests/test_sample_season.py` | The invented stretch of the season in `tests/sample_season.py`, which is played through the real command against the fake server, and the copy of its files in `nba-predictions-app/sample-data`: the copy is what the stretch writes, byte for byte, and it holds each state that the web app has to show, such as a game without a line, a day on which one model was left out and a game on a neutral floor. |

The web app has its own unit tests, written with Vitest and run with `npm test` in `nba-predictions-app/`. They cover the checks on the shape of the four files, the state behind the hooks that load them, the functions that turn the files into what each view shows, and the words and the markup of each view drawn in its states. [`nba-predictions-app/README.md`](nba-predictions-app/README.md#checks) lists the files.

`.github/workflows/ci.yml` runs on every push and pull request. Its token can only read the repository, and its actions are pinned to commit SHAs. It has three jobs:

- **Python tests:** installs the two requirements files on Python 3.12 and runs pytest.
- **dbt parse and compile:** installs `dbt-snowflake`, then runs `dbt parse` and an offline `dbt compile` with the placeholder profile in `nba_dbt/ci`. Neither connects to a warehouse.
- **Web app lint, type check, tests and build:** on Node 22, runs `npm ci`, the lint, the type check, the unit tests and the build in `nba-predictions-app/`. It then fails if the built files contain `apiKey=`, `the-odds-api` or `VITE_VERCEL_`. Last, it builds once more with `VITE_SPORTS_API_KEY` set to a dummy value and fails if that value is in the output.

## Known gaps

- **The dbt models have not been run against Snowflake.** `nba_dbt/` turns the raw scoreboard JSON into a view of games and a table of team results. `dbt parse`, an offline `dbt compile` and a build against the fakesnow emulator all pass, but the emulator is not Snowflake, and the models have not been built in a Snowflake account. [`nba_dbt/README.md`](nba_dbt/README.md#what-has-and-has-not-been-verified) says exactly what was checked. Nothing downstream reads the two models yet.
- **The notebooks are analysis, and nothing is served from them.** The two notebooks stay as they are, a walkthrough and an exploration with the caveats given above. The models whose forecasts are published, and which the web app shows, are the two in `pipeline/model/`.
- **The ingestion flows are not scheduled.** There is no Prefect deployment, the flows are run by hand, and the S3-to-Snowflake step is a script rather than a flow. The only scheduled job is the odds snapshot workflow, which GitHub Actions runs.
- **The record of the models against the sportsbooks is empty until games are played.** The job grades the sportsbooks' line and the two models against the results and writes the comparison to `record.json`. The season starts on 20 October 2026. As of 10 October 2026 the daily work with the models had been run only against a local stand-in for the API with invented games, and no scores response of the provider had been seen. [`pipeline/README.md`](pipeline/README.md#what-has-been-checked-and-what-has-not) says what was checked. Until then the web app says in each view what is not there yet.
- **The backtest behind the two models cannot be repeated from this repository.** It was run on game results from a feed that publishes no terms of use, so the results are not here. What is here are the parameters and ratings derived from them, a test that holds the Elo rule to a season that FiveThirtyEight published, and a test that holds the points-and-rest code to the expected values of its reference implementation. [`pipeline/model/README.md`](pipeline/model/README.md#how-the-two-were-chosen) gives the figures and says which of them were run again here.
- **The models' files are for one season and partly kept by hand.** The games on a neutral floor are a list in `pipeline/model/points_rest_2026_27.json`, and the final of the NBA Cup, on 11 December 2026, has to be added to it when its two teams are known. Before 2027-28 both opening files have to be replaced.
- **Skipping files that are already loaded is left to Snowflake, and has not been run there.** `move_nba_data_to_sf.py` used to look for an earlier load with a `SHOW COPY HISTORY` statement, which Snowflake does not have. That check is gone. `COPY INTO` ignores a staged file it has already loaded into the table unless `FORCE = TRUE` is given ([usage notes](https://docs.snowflake.com/en/sql-reference/sql/copy-into-table#usage-notes)), going by load metadata that Snowflake keeps on the table for 64 days ([load metadata](https://docs.snowflake.com/en/user-guide/data-load-considerations-load#load-metadata)), and the script logs what the statement returned. This follows Snowflake's documentation and is covered by tests with a fake connection, but it has not been run against Snowflake. Two limits are known. The `COPY INTO` reference lists the result columns for a loaded file but does not show the result for a skipped one, so the script treats both forms it knows of as already loaded: a single status row (`Copy executed with 0 files processed.`) and a file row with the status `LOAD_SKIPPED`. And a file older than 64 days whose load status Snowflake can no longer determine is skipped by default as well, and the script reports it as already loaded too.
- **The S3 listing is not paginated.** `move_nba_data_to_sf.py` makes a single `list_objects_v2` call, which returns at most 1,000 keys, so with more files than that under `raw/` it would stop seeing the newest one.
- **Tests cover only part of the code.** The load script, the transformation task, the dbt models and the odds pipeline have tests, and so have the web app's handling of the data and its wording. The ingestion flow in `fetch_nba_data.py` and the notebooks have none, and CI does not test the web app's components in a browser.

## Acknowledgements

- `predict_past.ipynb` is based on Dataquest's NBA game prediction walkthrough: https://github.com/dataquestio/project-walkthroughs/tree/master/nba_games
- NBA data comes from the [`nba_api`](https://github.com/swar/nba_api) package; odds and final scores come from [The Odds API](https://the-odds-api.com/).
- The Elo method and the ratings that the Elo model starts from are FiveThirtyEight's, from its [NBA forecasts data](https://github.com/fivethirtyeight/data/tree/master/nba-forecasts), published under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/). `tests/fixtures/fivethirtyeight_nba_elo_2022_23.csv` is an extract of that data, and the note beside it says what was taken.
