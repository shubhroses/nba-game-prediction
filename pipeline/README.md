# Odds snapshots (`pipeline/`)

A scheduled job that records, six times a day, what US sportsbooks imply about each upcoming NBA game: the home team's chance of winning, with the sportsbooks' margin taken out. A GitHub Actions workflow runs it and commits the result to the [`data` branch](https://github.com/shubhroses/nba-game-prediction/tree/data) of this repository.

Nothing reads the files yet. They are collected now because they cannot be collected later: the free plan of [The Odds API](https://the-odds-api.com/) has no historical data, so a game's line as it stood before tip-off can only be captured before tip-off. A later step is meant to grade predictions against results, and it will need those lines.

The package uses the Python standard library only and needs Python 3.11 or newer. On Windows, `zoneinfo` additionally needs the `tzdata` package from PyPI.

## What one run does

1. It reads the clock and works out which [slot](#schedule) it is in.
2. It reads the state file of the last run from the data directory and checks it. If the slot is already recorded there, it prints one line and stops. If the slot is not recorded but started 75 minutes ago or more, it [gives the slot up](#the-75-minutes), prints one line and stops. Either way no request is made.
3. Otherwise it sends one request: `GET https://api.the-odds-api.com/v4/sports/{sport}/odds` with `regions=us`, `markets=h2h`, `oddsFormat=decimal` and `commenceTimeFrom` set to the current time, so that games in play are left out. The request is not repeated within the run, whatever comes of it. The timeout is 20 seconds for connecting and for each wait for data. It is not a limit on the whole request: a response that arrives a little at a time can take longer, and what limits that is the job's 10 minutes.
4. For every game that has not started it computes the [consensus](#the-consensus) of the sportsbooks.
5. It builds the [three files](#the-files), [checks them](#checks-before-anything-is-written), writes them to a temporary directory and moves them into place.
6. The workflow commits what was written to the `data` branch.

With `--all` there can be more than one sport. The state files of all of them are read first. Then each sport that is due goes through steps 3 to 5 on its own, before the next one is started. A sport that fails does not stop the next one and does not undo one that was written.

| Module | What is in it |
| --- | --- |
| `config.py` | The sports to capture and the directory each is written under. |
| `schedule.py` | The six slots, the rule for when a snapshot is due, and for how long a slot may be asked for. |
| `oddsapi.py` | The request and its errors. |
| `teams.py` | The 30 team names as the provider spells them, with the NBA's three-letter codes. |
| `consensus.py` | The margin-free home probability of one sportsbook, and the median across sportsbooks. |
| `snapshot.py` | Builds the board, the state and the history lines from a response and the previous state. A pure function. |
| `validate.py` | The checks on the three files. |
| `store.py` | Reads the previous files, writes the new ones, and removes the temporary directory of a run that was killed while it wrote. |
| `timestamps.py` | The one timestamp format. |
| `__main__.py` | The command line. |

## The consensus

A sportsbook quotes a decimal price for each team. A price `p` implies a probability of `1/p`. The two implied probabilities of a game add up to more than 1, and the excess is the sportsbook's margin. Dividing the home side by the total removes the margin:

```
home share = (1/home) / (1/home + 1/away) = away / (home + away)
```

With invented prices of 1.50 for the home team and 2.70 for the away team, the implied probabilities are 0.6667 and 0.3704, which add up to 1.037, and the home share is 2.70 / 4.20 = 0.6429. The web app's `processGames` normalises the same way, for the first sportsbook only.

For one game:

- A sportsbook is used when its head-to-head market quotes both teams at a price above 1.
- The consensus `p_home` is the median of the home shares of the sportsbooks used. With an even number that is the mean of the middle two.
- `lo` and `hi` are the lowest and the highest home share, and `n` is the number of sportsbooks used.
- `books` is the sorted list of their names when `lo` and `hi` differ. When the two are written as the same number, which is always so for a single sportsbook, the sportsbooks are [counted but not named](#what-is-not-published).
- If no sportsbook can be used the game has no line. That is written as `null`, never as a number.

## Schedule

There are six slots a day, at fixed wall-clock times in `America/New_York`:

| New York | UTC until 1 November 2026 (daylight saving time) | UTC from 1 November 2026 (standard time) |
| --- | --- | --- |
| 05:10 | 09:10 | 10:10 |
| 09:10 | 13:10 | 14:10 |
| 12:10 | 16:10 | 17:10 |
| 15:10 | 19:10 | 20:10 |
| 18:10 | 22:10 | 23:10 |
| 21:10 | 01:10 the next day | 02:10 the next day |

A slot's id is its start in New York time with the UTC offset, for example `2026-10-20T18:10-04:00`. A run is in the most recent slot that has started. A snapshot is due when that slot's id differs from `last_slot` in the state file and the run started less than [75 minutes](#the-75-minutes) after the slot did.

The workflow is triggered twice an hour, at minutes 10 and 40 (`cron: "10,40 * * * *"`), which is 48 times a day for 6 snapshots. The reason is that GitHub does not promise to start a scheduled run on time: its documentation says that the [`schedule` event can be delayed](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) when Actions is under load. With a trigger every 30 minutes, a slot whose first trigger is late, is missing or fails is taken by the next one. A trigger that finds its slot already recorded costs a short workflow run and no request. New York is always a whole number of hours from UTC, so every slot starts on a minute-10 trigger.

A late run still records every game that has not started. A game that started before the run is left out of that snapshot, and its last line is the one from the slot before.

### The 75 minutes

A slot that is not recorded may be asked for only by a run that starts less than 75 minutes after the slot's start. A run that starts later gives the slot up. It prints `Slot ... was not recorded in time; the next slot starts at ...`, makes no request, writes nothing and ends with status 0. `--force` ignores the limit, as it ignores a recorded slot.

The limit is there because the job keeps no record of an attempt that failed. Without it, a failure that lasts would be asked for again at every trigger of the slot: 6, 8 or 16 times, depending on the length of the slot. The triggers of a slot come at its start and every 30 minutes after it, so three of them are inside the 75 minutes: at 0, 30 and 60. The run of any later trigger does not ask, whatever went wrong before it, and also when the job could write or push nothing at all. [What a failure costs](#what-a-failure-costs) says what that comes to.

Why 75. GitHub starts scheduled runs late: in a measurement of four public repositories the median delay was 13 to 21 minutes. The first two triggers of a slot must still fit, and with 75 minutes the second one fits when it starts less than 45 minutes late. Every run that fits is one more request while a failure lasts, and beyond 90 minutes a fourth trigger would fit. The number is `ATTEMPT_WINDOW` in `schedule.py`.

What it costs. A slot is recorded only if a run starts within its first 75 minutes and succeeds. If GitHub starts no run in that time, or every run in it fails, the slot stays empty: no later run takes it.

## Credits

The free plan allows 500 credits a month. The provider's [guide](https://the-odds-api.com/liveapi/guides/v4/) puts the cost of an odds request at one credit per region per market, so each request here costs 1, and says that a request that returns no events is not charged.

The plan is one request for each sport in each slot:

- The regular season: 6 requests a day. In a 31-day month that is 186 credits.
- The [preseason rehearsal](#configuration): 6 more a day while it lasts. It ends on 17 October 2026, so it adds at most 48 credits if the job starts on 10 October, and fewer if it starts later.
- A run started by hand costs one request per sport when it asks: in the first 75 minutes of a slot that is not recorded, or with `force`. That holds for a dry run too.

Every response reports the credits left, and the job writes them to `state.json`, prints them and puts them in the job summary.

### What a failure costs

A run that fails before its request costs nothing, which is why the state file, the key and the day's history file are checked first. From the request on, two rules bound the cost:

- A run sends one request for a sport and does not repeat it, whatever comes of it. The next trigger, half an hour later, is the retry.
- Only a run that starts in the first [75 minutes](#the-75-minutes) of a slot asks for it, and three scheduled runs do.

So a slot costs at most 3 requests for each sport, and the six slots of a day at most 18, whatever goes wrong and for as long as it goes wrong:

| What happens at every trigger | Requests for a slot, for each sport | Requests a day, for each sport |
| --- | --- | --- |
| Nothing goes wrong | 1 | 6 |
| The provider refuses: 401, 429 or another 4xx | 3 | 18 |
| The provider answers 5xx, or does not answer, or cannot be reached | 3 | 18 |
| A 200 that cannot be read | 3 | 18 |
| Validation refuses the files | 3 | 18 |
| The files cannot be written | 3 | 18 |
| The push is refused, or the run is killed after its request | 3 | 18 |

These are the numbers that `tests/test_pipeline_credits.py` counts. It walks every trigger of a day through the command for each row: with 401 and with 429, with 503 and with a provider that never answers, and with the data directory put back to what it was after each run for the last row. The sports are counted one by one because each is [taken on its own](#exit-status). When one sport fails and another answers, the one that answers is written and pushed and costs 1 for the slot, and only the one that fails is asked for again.

After the third run the slot is given up and the job waits for the next one. Each run that asked and failed fails the workflow run, which is what tells the owner. The runs that find the slot given up end with status 0.

What the worst case means for the month. The plan for the regular season leaves 314 of the 500 credits of a 31-day month unused. A day on which every slot is asked for three times costs 12 more than planned, so there is room for 26 such days. A failure of every slot that lasted the whole month would come to 558 requests and would use the credits up after 27 days.

Two things are not in these numbers:

- They count requests, not credits. Whether the provider charges for a request that it refuses or does not answer is not known, so the credits spent can be fewer.
- They count three runs for a slot, which is what the schedule starts in 75 minutes. Any run that starts in that time asks. A run started by hand is one more. So is the last trigger before the slot, if GitHub starts it more than 30 minutes late and then starts the next three nearly on time.

## The files

Each sport is written under its own prefix. `basketball_nba` is under `v1`.

Common to all three files:

- A time is in UTC, to the second: `2026-10-20T22:10:41Z`. The exceptions are `slot`, `next_due` and `last_slot`, which are slot ids.
- A probability is the home team's chance of winning, rounded to four decimals. It is always strictly between 0 and 1: a value that would round to 0 or 1 is written as 0.0001 or 0.9999.
- A team is its three-letter code, such as `BOS`. The table is in `teams.py`.
- The JSON files are written with sorted keys, a two-space indent and a final newline.

The format of the history files is final, because history only grows. `schema` is 1 in the other two files.

### `{prefix}/slate.json`

The board: the upcoming games as of the latest snapshot. Replaced by every snapshot.

```json
{
  "games": [
    {
      "away": "NYK",
      "commence_time": "2026-10-20T23:00:00Z",
      "home": "BOS",
      "id": "5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10",
      "line": {
        "books": [
          "Book A",
          "Book B",
          "Book C"
        ],
        "captured_at": "2026-10-20T22:10:41Z",
        "hi": 0.6542,
        "lo": 0.6265,
        "n": 3,
        "p_home": 0.6429
      },
      "open": {
        "at": "2026-10-19T13:10:22Z",
        "p_home": 0.6143
      }
    },
    {
      "away": "CHI",
      "commence_time": "2026-10-22T23:30:00Z",
      "home": "MIA",
      "id": "9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d",
      "line": null,
      "open": null
    }
  ],
  "generated_at": "2026-10-20T22:10:41Z",
  "next_due": "2026-10-20T21:10-04:00",
  "schema": 1,
  "slot": "2026-10-20T18:10-04:00",
  "sport": "basketball_nba"
}
```

| Field | Meaning |
| --- | --- |
| `schema` | 1. |
| `sport` | The sport's key in The Odds API. |
| `generated_at` | When the response was received. |
| `slot` | The id of the slot this snapshot belongs to. |
| `next_due` | The id of the next slot. |
| `games` | The games in the response that had not started at `generated_at`, sorted by start time and then by id. An event that [cannot be used](#checks-before-anything-is-written) is not listed. |
| `games[].id` | The provider's id for the game. |
| `games[].commence_time` | The scheduled start. |
| `games[].home`, `games[].away` | Team codes. |
| `games[].line` | The consensus in this snapshot: `p_home`, `lo`, `hi`, `n`, `books` and `captured_at`. `books` is the sorted list of the sportsbooks' names, or an empty list when `lo` equals `hi`, as it does when `n` is 1. `null` when no sportsbook quoted both teams in this snapshot. |
| `games[].open` | The opening line: `p_home` and `at` of the first snapshot in which the game had a line. `null` if it never had one. |

### `{prefix}/state.json`

What the job remembers between runs.

```json
{
  "credits": {
    "last": 1,
    "remaining": 432,
    "used": 68
  },
  "games": {
    "5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10": {
      "away": "NYK",
      "commence_time": "2026-10-20T23:00:00Z",
      "first": {
        "at": "2026-10-19T13:10:22Z",
        "p_home": 0.6143
      },
      "home": "BOS",
      "latest": {
        "at": "2026-10-20T22:10:41Z",
        "hi": 0.6542,
        "lo": 0.6265,
        "n": 3,
        "p_home": 0.6429
      }
    },
    "9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d": {
      "away": "CHI",
      "commence_time": "2026-10-22T23:30:00Z",
      "first": null,
      "home": "MIA",
      "latest": null
    }
  },
  "last_run_at": "2026-10-20T22:10:41Z",
  "last_slot": "2026-10-20T18:10-04:00",
  "schema": 1
}
```

| Field | Meaning |
| --- | --- |
| `schema` | 1. |
| `last_slot` | The id of the last slot recorded. The next run compares its own slot with this. |
| `last_run_at` | When that snapshot's response was received. |
| `credits` | The quota headers of that response: `remaining` (`x-requests-remaining`), `used` (`x-requests-used`) and `last` (`x-requests-last`, the cost of the request). `null` for a header that was missing. |
| `games` | One entry per game, keyed by the provider's id. |
| `games.{id}.commence_time`, `home`, `away` | As in the board, as of the last snapshot that listed the game. |
| `games.{id}.first` | The opening line: `p_home` and `at`. `null` until the game has a line. |
| `games.{id}.latest` | The most recent line: `p_home`, `lo`, `hi`, `n` and `at`. `null` until the game has a line. |

The rules the state follows:

- The first line seen for a game is kept as `first` and never replaced.
- `latest` is replaced only by a snapshot taken before the game starts, and only when the game has a line in that snapshot. Once a game has started, `latest` is its last line from before the start, which is what grading needs.
- A game stays until 14 days after its start and is then removed.
- A game that is missing from a response stays as it is.

### `{prefix}/history/YYYY-MM-DD.ndjson`

One file per UTC date, named after the date of the snapshot. Each snapshot adds one line for every game that has a line in it. A game without a line gets none.

```
{"id":"5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10","at":"2026-10-20T22:10:41Z","p_home":0.6429,"lo":0.6265,"hi":0.6542,"n":3}
```

| Field | Meaning |
| --- | --- |
| `id` | The provider's id for the game. |
| `at` | When the snapshot's response was received. |
| `p_home` | The consensus. |
| `lo`, `hi` | The lowest and the highest home share among the sportsbooks. |
| `n` | The number of sportsbooks. |

Each line is one JSON object without spaces, with its fields in this order. Lines are only added at the end. A file is never rewritten or shortened.

### What is not published

The provider's [terms](https://the-odds-api.com/terms-and-conditions.html) do not allow its data to be redistributed as a data product, downloadable files included. They do allow values derived from the data to be calculated and displayed. So the files hold derived values only. There is no response and no price in them, and no list of what each sportsbook quoted: the names in `books` say which sportsbooks went into a consensus and nothing more.

When only one sportsbook quotes a game, the consensus is that one sportsbook's probability with its margin removed. The line is published all the same, with `n` set to 1, but `books` is left empty, so that no file puts a number to the name of a single sportsbook. The two prices behind the number are not published and cannot be worked out from it. With two sportsbooks, `lo` and `hi` are their two probabilities and both are named, without saying which is whose. When all the sportsbooks of a game give the same probability, so that `lo` and `hi` are written as the same number, their names would say what each of them gave. `books` is left empty then too, whatever `n` is.

No real odds are in this repository either. The tests and the fake server use invented prices.

## Checks before anything is written

`validate.py` returns a list of problems. If the list is not empty, that sport's part of the run ends with status 2 and nothing is written for it.

- Every probability is a number strictly between 0 and 1, and `lo <= p_home <= hi`.
- `n` is a whole number of at least 1. The board names as many sportsbooks as it counts, and none when it counts one or when `lo` equals `hi`.
- Every team code is one of the 30.
- Every game on the board starts after the snapshot time.
- History only grows: the content already in the day's file must be the beginning of the new content, the existing file must end with a newline, and every added line must be a complete record with the six fields in order.
- Every time is in the one UTC format, and `schema` is 1.

The state file of the previous run goes through the same checks when it is read. A state file that fails them, or that is not JSON, stops its sport before the request.

An event in the response that cannot be used is a different matter. It is left out and reported in the log, and the run goes on. That covers a team name that is not one of the 30, which happens in the preseason when an NBA team plays a club from another league, and an event without a usable id or start time.

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | A snapshot was taken, or none was due, or the slot was [given up](#the-75-minutes). |
| 1 | Bad arguments or settings: for example `ODDS_API_KEY` is not set. Also when the files could not be written. |
| 2 | Validation failed. |
| 3 | The provider refused the request: HTTP 401, 429, or any other answer that is neither a success nor a 5xx. |
| 4 | The provider gave no usable answer: a network error, a timeout, a 5xx, or a response that could not be read as a list of events. |

No request is repeated within a run, whichever of these it ends with.

Each sport is taken on its own. For a sport that fails nothing is written. A sport that was written stays written when another one fails, before it or after it, and the next trigger then finds it recorded and asks for the failed one only.

There is one way for a failed sport to leave something behind. Its files are moved into place one after the other: the day's history, the board, and the state file last. If a move fails after an earlier one has worked, the files moved before it are already the new ones, although the message says that nothing was written. The state file is still the old one, so the slot is not recorded: a later run in time takes it again and adds its own lines after those in the history. If another sport was written in the same run, the workflow commits the moved files with it. The run ends with the status of the first failure, its messages name each sport that failed, and it reports `changed=true` because there is something to push.

A message never contains the request URL or the key. For a refusal it gives the status and the provider's error code, as in `HTTP 401 (INVALID_KEY)`. An error that nobody foresaw while the answer was fetched and read ends with status 4 as well and is named by its class only, as in `the response could not be read (RecursionError)` for a body that is nested too deep.

## Running it

```
python -m pipeline snapshot --data-dir DIR (--all | --sport KEY [--prefix NAME]) [--force] [--dry-run]
```

| Option | Meaning |
| --- | --- |
| `--data-dir DIR` | A checkout of the data branch. It is created if it does not exist. |
| `--all` | Every sport in `config.py` that is captured today. The workflow uses this. |
| `--sport KEY` | One sport. Without `--prefix` it must be in `config.py`. |
| `--prefix NAME` | With `--sport`: the directory under `DIR` to write to. |
| `--force` | Take a snapshot even if the current slot is already recorded, or started 75 minutes ago or more. |
| `--dry-run` | Fetch and validate, but write nothing. In a slot that is recorded, or that started 75 minutes ago or more, it makes no request unless `--force` is given too. |

The key is read from the environment variable `ODDS_API_KEY`. When `GITHUB_OUTPUT` is set, as it is in GitHub Actions, the command also appends these to the file it names:

| Output | Meaning |
| --- | --- |
| `changed` | `true` when something was written, otherwise `false`. Always there. |
| `slot` | The id of the slot. Always there. |
| `games`, `with_line`, `dropped` | The counts, as totals over the sports that were taken in this run. Left out when none was. |
| `credits_remaining`, `credits_used`, `credits_spent` | From the quota headers: the first two from the last response, the third added up. Left out when no sport was taken. |
| `written` | The count for each prefix that was written, as in `v1 12 games, v1-dryrun 3 games`. Left out when nothing was written. |
| `failed` | The sports that failed. Left out when none did. |
| `given_up` | The sports whose slot was not recorded in time. Left out when there is none. |

### Against the fake server

`tests/fake_odds_api.py` is a local stand-in for the API with invented games and prices. It needs no key and no network:

```bash
python tests/fake_odds_api.py --port 8765 &

export ODDS_API_BASE_URL=http://127.0.0.1:8765
export ODDS_API_KEY=any-value
python -m pipeline snapshot --all --data-dir /tmp/odds-data --force  # writes the files
python -m pipeline snapshot --all --data-dir /tmp/odds-data          # "Not due", no request
python -m pipeline snapshot --all --data-dir /tmp/odds-data --force  # a second snapshot
```

The first command is forced because, without `--force`, a run takes a slot only in its first 75 minutes. At any other time of day it would print that the slot was not recorded in time and make no request.

The fake server moves its prices a little with each request, so after the second forced run the history file has two lines per game, `latest` has changed and `first` has not.

`ODDS_API_BASE_URL` exists for this purpose only. It is accepted when it names a server on the local machine (`127.0.0.1`, `localhost` or `::1`) and refused otherwise, so that a stray setting cannot send a real key somewhere else.

## Configuration

`config.py` lists two sports:

| Sport key | Prefix | Captured |
| --- | --- | --- |
| `basketball_nba` | `v1` | Always. |
| `basketball_nba_preseason` | `v1-dryrun` | Until 17 October 2026, New York date, that day included. |

The preseason entry is a rehearsal. The regular season starts on 20 October 2026, and the grading step has to be tried on real games before then. It is written under its own prefix so that it stays apart from the record, and the entry is to be deleted after opening night.

## The workflow

`.github/workflows/pipeline.yml`, named `Odds snapshot`, runs on the schedule above and by hand (`workflow_dispatch`, with the inputs `force` and `dry_run`). The inputs are the command's `--force` and `--dry-run`. A dry run in a slot that is already recorded, or that started 75 minutes ago or more, makes no request unless `force` is set as well.

- **One run at a time.** The runs share a concurrency group, and a run in progress is not cancelled.
- **Permissions.** The workflow's token can only read the repository. The one job is given `contents: write`, because it pushes to the `data` branch. The two actions it uses are the ones the CI workflow uses, pinned to the same commits.
- **The API key** is the repository secret `ODDS_API_KEY`. It is in the environment of the step that runs the pipeline and of no other step. The pipeline never prints it, and the workflow does not turn on shell tracing.
- **The data branch** is checked out into a second working tree, `data-branch/`, with plain git commands. Fetching needs no credentials. For the push, git is given a credential helper that reads the workflow's token from the environment, so the token is not written to disk.
- **The first run.** If there is no `data` branch yet, the job starts one that shares no history with `main`. Its first commit holds the two files in `.github/data-branch/`: a README for the branch, and `nba-predictions-app/vercel.json` with `{"git": {"deploymentEnabled": false}}`. Vercel builds the `nba-predictions-app` folder of every branch that is pushed to this repository, and that [setting](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled) tells it not to deploy this one.
- **The commit.** When the pipeline reports `changed=true` and the run is not a dry run, the job commits everything in the data tree as `github-actions[bot]` and pushes to `data`. The message gives the count for each prefix that was written, as in `Snapshot 2026-10-20T18:10-04:00: v1 12 games, v1-dryrun 3 games`. It never pushes to `main` and never forces. The push is made with the workflow's own token, and GitHub [does not start workflow runs](https://docs.github.com/en/actions/concepts/security/github_token) for events caused by that token, so CI does not run on the snapshot commits.
- **One sport failed, another was written.** The pipeline step then ends with a failure and reports `changed=true`. The commit step has `!cancelled()` in its condition, so it runs all the same and pushes what was written. The job still ends as failed, because one of its steps failed, and that is what tells the owner.
- **A push that is refused.** If the branch has moved in the meantime, or the remote turns the push away for another reason, the run fails and nothing of it is recorded. The next run asks again, if it starts within the slot's 75 minutes.
- **The summary** of each run says whether a snapshot was taken, how many games it has and how many credits are left, which sports failed, and when a slot was given up.

## Tests

```bash
python -m pytest tests/test_pipeline_*.py
```

They need pytest and nothing else, make no request to The Odds API, and use a dummy key and invented prices.

| File | What it covers |
| --- | --- |
| `tests/test_pipeline_teams.py` | The team table against the web app's logo table, the scoreboard fixture and `nba_api`'s list of teams. The last check is skipped when `nba_api` is not installed. |
| `tests/test_pipeline_consensus.py` | The margin-free share, the median, the range and the count, and every way a sportsbook's quote can be unusable. |
| `tests/test_pipeline_schedule.py` | The slot table on 31 October, 1 November and 2 November 2026, across the end of daylight saving time, the cron triggers walked over those three days, and the 75 minutes: which triggers of a slot start in time. |
| `tests/test_pipeline_timestamps.py` | The timestamp format. |
| `tests/test_pipeline_snapshot.py` | The three outputs for a response, that a single sportsbook is not named and neither are several that all give the same probability, and the state rules: the opening line is kept, a started game's line is never replaced, a game leaves after 14 days, an unusable event is dropped and reported. |
| `tests/test_pipeline_validate.py` | Each check, by breaking one thing in a valid snapshot. |
| `tests/test_pipeline_store.py` | The file formats on disk, that a write which fails before any file is moved leaves the data directory as it was, the order of the moves, and that the temporary directory of a killed run is removed. |
| `tests/test_pipeline_oddsapi.py` | The request against the fake server: its parameters, that it is sent once whatever comes of it, the refusals, a redirect, a body that is nested too deep, and that no error message or traceback holds the key or the URL. |
| `tests/test_pipeline_cli.py` | The command from end to end: a first run, a second run in the same slot, three slots of one evening, 401, 429 and 503, a validation failure, files that cannot be written, a slot just inside and just outside its 75 minutes, `--dry-run`, `--force`, and `--all` with two sports of which one fails. After every run it looks for the dummy key in the output and in the files. |
| `tests/test_pipeline_credits.py` | The bound on requests. Every cron trigger of a day is walked through the command, on an ordinary day and on the days of 25 and of 23 hours, once for each way a run can end. The requests are counted for each slot, each sport and the day. |
| `tests/test_pipeline_workflow.py` | The workflow file, read as text: every slot starts on a cron trigger, the 75 minutes are given as `schedule.py` has them, the actions are pinned to the commits CI uses, the token is read-only outside the job that pushes, the checkout keeps no credentials, the key goes to one step, runs wait for each other and none is cancelled, the job is limited to 10 minutes, what was written is pushed although the pipeline step failed and that step still fails the job, the commit message has the count for each prefix, and the only push is an unforced one to `data`. |

## What has been checked, and what has not

Checked, as of 10 October 2026:

- The tests above pass on Python 3.11, 3.12, 3.13 and 3.14. The whole test suite, with the repository's requirements installed, passes on Python 3.12 on Linux, which is what CI runs.
- The tests that came with the bound on requests were each run once against the code with the behaviour they name broken, on a scratch copy, and failed: with the 75 minutes left out or made longer or shorter, a request sent again within a run, nothing written unless every sport succeeds, the commit step skipped after a failed step, and so on.
- Every cron trigger of 31 October to 2 November 2026, when the clocks go back, and of 15 to 18 October 2026, when two sports are captured until the 17th, was walked through the command in a Linux container, with the system clock set for each run and a local stand-in for the provider, once for each row of the table in [What a failure costs](#what-a-failure-costs). The walks were repeated with every run starting 5, 20, 40 or 70 minutes late, with triggers that never run, and with one sport failing while the other answers. No sport was asked for more than 3 times for a slot, or more than 18 times for the six slots of a day. Two rows needed more than a stand-in: validation was made to refuse the files by a fault put into the builder, and the provider that never answers, with the command waiting its real 20 seconds each time, was walked for 31 October to 2 November and for 16 October only. With a run by hand in every slot, or with the trigger before every slot starting 31 minutes late, each slot was asked for 4 times, and for 5 times when the two triggers before it both started late. Those are the runs that the numbers of that section leave out.
- The shell steps of the workflow were run on a developer machine and in a Linux container, against a temporary bare git repository standing in for `origin` and against the fake server, with the clock of the pipeline step set for each run. The runs were: a dry run before there is a `data` branch, the first run that starts the branch, a second trigger in the same slot, a second snapshot in the next slot that adds to the history, one sport failing while the other is pushed and the job fails, the three triggers after that, a push that the remote refuses at each trigger of a slot until the slot is given up, the slot after it, dry runs with and without `force`, a forced run in a slot that was too old, a refusal by the provider, a push after the branch had moved, and a remote that could not be reached. The same steps were run against a local git server over HTTP that asks for a password on a push, to check the credential helper, with a token, without one and with a wrong one.
- The builder, the validator and the command were run on one real response of the `basketball_nba` endpoint, captured on 9 October 2026 and served by the fake server. All 46 games in it were recorded and none was dropped. 23 of them were quoted by a single sportsbook and were written without a name. That response is not kept in the repository.
- `actionlint` reports nothing for the workflow file.

Not checked:

- The workflow has not run on GitHub, and this code has not yet sent a request to The Odds API.
- The rehearsal applies the conditions of the steps by hand. That GitHub runs the commit step after a failed pipeline step, as `!cancelled()` says it will, has not been seen.
- How late GitHub starts the scheduled runs of this repository is not known. The 13 to 21 minutes behind the [75 minutes](#the-75-minutes) were measured on four other repositories.
- Whether Vercel leaves the `data` branch alone can only be seen after the first push.
- A response of the `basketball_nba_preseason` endpoint has not been seen.
- A refusal by the provider has not been seen. The job looks for the provider's error code in a field named `error_code` of the error body. If the field has another name, the message gives the HTTP status alone. Whether a refused or an unanswered request is charged is not known either.

## Limits

- The job knows nothing about the calendar. Out of season it would keep asking six times a day and commit empty boards. Disable the workflow when the season is over.
- A snapshot is only as punctual as GitHub's scheduler. A game that starts between a slot's start and a late run is missing from that snapshot.
- A slot in which no run starts within [75 minutes](#the-75-minutes), or in which every such run fails, is not recorded, and nothing takes it later. That is the price of the bound on requests.
- That bound counts on no more than three runs starting in a slot's first 75 minutes. [What a failure costs](#what-a-failure-costs) names the two ways a fourth can.
- GitHub [disables scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) in a public repository after 60 days without repository activity.
- A game is identified by the provider's event id. If the provider gave a rescheduled game a new id, it would be recorded as a new game.
- An event that cannot be used is left out and reported, and the run succeeds. If the provider changed the shape of every event, the runs would go on succeeding with empty boards. The number of dropped events in the log and in the job summary is where that would show.
