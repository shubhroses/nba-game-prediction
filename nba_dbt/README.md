# nba_dbt

dbt project that turns the raw NBA scoreboard JSON in Snowflake into two relations.

| Relation | Materialized as | One row per | Built from |
| --- | --- | --- | --- |
| `stg_nba__games` | view | game | source `nba.raw_nba_scoreboard` |
| `fct_team_games` | table | team per game | `stg_nba__games` |

The SQL is written for Snowflake (`VARIANT` paths, `LATERAL FLATTEN`, `QUALIFY`), so the project needs the `dbt-snowflake` adapter, which the repository's `requirements.txt` installs. `dbt_project.yml` requires dbt 1.10.5 or later.

## Source

`RAW_NBA_SCOREBOARD (game_data VARIANT)` is created and filled by [`data_ingestion/move_nba_data_to_sf.py`](../data_ingestion/move_nba_data_to_sf.py). Each row is one file from S3, and each file is one response of the NBA live scoreboard as returned by `nba_api`: a `meta` object, and a `scoreboard` object with the game date and a `games` array. The ingestion flow can run several times a day, so the same game is usually in more than one row.

The source is looked up in the database and schema named by the `SNOWFLAKE_DATABASE` and `SNOWFLAKE_SCHEMA` environment variables, because that is where the load script creates the table. `data_transformation/transform_data.py` loads both from `.env` before it calls dbt. When a variable is not set, dbt uses the database or schema of the active target instead.

## Models

### `stg_nba__games`

Unpacks the `games` array of every response and keeps one snapshot per game id.

| Column | From the response | Notes |
| --- | --- | --- |
| `game_id` | `gameId` | |
| `game_date` | `scoreboard.gameDate` | The day the game is listed under. |
| `game_status_id` | `gameStatus` | 1 before tip-off, 2 in progress, 3 final. |
| `game_status_text` | `gameStatusText` | For example `7:30 pm ET` or `Final`. |
| `is_final` | | `game_status_id = 3`. |
| `home_team_id`, `away_team_id` | `homeTeam.teamId`, `awayTeam.teamId` | |
| `home_team_tricode`, `away_team_tricode` | `homeTeam.teamTricode`, `awayTeam.teamTricode` | For example `BOS`. |
| `home_score`, `away_score` | `homeTeam.score`, `awayTeam.score` | 0 before tip-off, the running score during the game. |
| `snapshot_at` | `meta.time` | No time zone, because the feed gives none. |

`nba_api` does not document the `gameStatus` values. Its sample response has 3 with the status text `Final`, the response saved in `notebooks/predict_past.ipynb` has 1 with a tip-off time, and other clients of the same feed read 2 as in progress.

Those two responses are the only real ones the models were written from. A postponed, suspended or cancelled game has not been seen, and the models do not treat one specially.

Which snapshot is kept: the one with the highest `game_status_id`, and among those the one with the latest `snapshot_at`. The status is compared first because `meta.time` carries no time zone and may be missing.

### `fct_team_games`

Two rows per game, one from each team's side.

| Column | Notes |
| --- | --- |
| `team_game_id` | Key: `game_id`, a hyphen, `team_id`. |
| `game_id`, `game_date` | As in `stg_nba__games`. |
| `team_id`, `team_tricode` | The team the row is about. |
| `opponent_team_id`, `opponent_team_tricode` | The other team. |
| `home_away` | `home` or `away`. |
| `game_status_id`, `game_status_text`, `is_final` | As in `stg_nba__games`. |
| `points_for`, `points_against` | The team's and the opponent's score. Like the scores in the staging model, they are 0 before tip-off and partial during a game. |
| `won` | `points_for > points_against` when `is_final`, otherwise null. |

## Tests

Declared in the two `_*__models.yml` files and run by `dbt build` or `dbt test`:

- `stg_nba__games`: `game_id` is unique and not null; `game_date`, `game_status_id`, `home_team_id` and `away_team_id` are not null.
- `fct_team_games`: `team_game_id` is unique and not null; `game_id`, `team_id` and `home_away` are not null; `home_away` is `home` or `away`; every `game_id` exists in `stg_nba__games`.

## Running

Give dbt a profile named `nba_dbt`, for example in `~/.dbt/profiles.yml`. A profile that reuses the variables from the repository's `.env` looks like this:

```yaml
nba_dbt:
  target: dev
  outputs:
    dev:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_USER') }}"
      password: "{{ env_var('SNOWFLAKE_PASSWORD') }}"
      role: "{{ env_var('SNOWFLAKE_ROLE') }}"
      warehouse: "{{ env_var('SNOWFLAKE_WAREHOUSE') }}"
      database: "{{ env_var('SNOWFLAKE_DATABASE') }}"
      schema: "{{ env_var('SNOWFLAKE_SCHEMA') }}"
      threads: 1
```

dbt does not read `.env`, so export those variables in the shell first. Then, from the repository root:

```bash
pip install -r requirements.txt
dbt build --project-dir nba_dbt
```

`dbt build` creates the view, runs its tests, creates the table and runs its tests. If a test on the view fails, the table is not rebuilt.

## What has and has not been verified

The models and tests in this project have not been run against a Snowflake account. This is what has been checked instead, with dbt-core 1.12.5 and dbt-snowflake 1.12.1 on Python 3.12.

### dbt parse and dbt compile, offline

Both commands use the placeholder profile in [`ci/profiles.yml`](ci/profiles.yml), and neither opens a connection:

```bash
dbt parse   --project-dir nba_dbt --profiles-dir nba_dbt/ci
dbt compile --project-dir nba_dbt --profiles-dir nba_dbt/ci --no-populate-cache --no-introspect
```

- `dbt parse` succeeds, also with `--warn-error`, so the project, the source, both models and the 13 tests are valid dbt and raise no deprecation warnings.
- `dbt compile` renders every model and test to SQL. `--no-populate-cache` skips the catalog query that a plain `dbt compile` starts with (without it the command tries to connect and fails), and `--no-introspect` makes dbt stop rather than query the warehouse while rendering. In the compiled SQL the source resolves to the target's database and schema, or to `SNOWFLAKE_DATABASE` and `SNOWFLAKE_SCHEMA` when those are set.
- dbt accepts the example profile above: the same `dbt compile` succeeds with it when the seven variables hold placeholder values.
- The compiled SQL of both models and of the 13 tests also parses under the Snowflake grammar of sqlfluff 4.4.0 with no unparsable section (`sqlfluff parse --dialect snowflake <file>` on the files under `nba_dbt/target/compiled/`). This was checked once by hand and is not part of CI.

### The models on an emulator

[`tests/test_dbt_models.py`](../tests/test_dbt_models.py) builds the project against [fakesnow](https://github.com/tekumara/fakesnow), a local emulator. The real `dbt-snowflake` adapter connects to it, and it translates Snowflake SQL to DuckDB. The test puts scoreboard responses into `RAW_NBA_SCOREBOARD`, runs `dbt build` through the task function in `data_transformation/transform_data.py`, and compares every row of both models with the rows it expects:

- One response in which no game has started gives one row per game, and two rows per game in the mart with `won` null.
- More responses are then added out of order: the newest first, one of them twice, the first one again, and one for a day without games. Each game still has one row, taken from the response in which it is furthest along. Of the two finished games one is won at home and one away, and `won` is true for the winner and false for the loser. It stays null for the game still in progress.
- A response containing a game without an id makes the `not_null` test on `game_id` fail. The task exits with status 1 and the mart is not built.

The first response is real. It is the one saved in the output of `notebooks/predict_past.ipynb` (12 December 2024, three games, none started) and is kept in `tests/fixtures/scoreboard_20241212.json`. The later ones are copies of it with made-up statuses and scores.

To run it, from the repository root:

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/test_dbt_models.py
```

Last run with fakesnow 0.11.20 on DuckDB 1.5.6.

### Limits

fakesnow is not Snowflake. A pass shows that dbt can build the project, that the emulator's Snowflake SQL parser accepts the statements, and that they return the intended rows on DuckDB. It does not show that Snowflake accepts or evaluates every expression the same way. One difference turned up while the test was being written: read through the emulator's server, a NULL timestamp came back as 1970-01-01 00:00:00.

The example profile has not been used to connect to Snowflake either.
