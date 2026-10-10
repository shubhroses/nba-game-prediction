# Odds snapshots and results (`pipeline/`)

A scheduled job that does two things for NBA games. Six times a day it records what US sportsbooks imply about each upcoming game: the home team's chance of winning, with the sportsbooks' margin taken out. Once a day it records how the games that are over ended and grades each of them: did the side that the sportsbooks favored before the game win? A GitHub Actions workflow runs it and commits the result to the [`data` branch](https://github.com/shubhroses/nba-game-prediction/tree/data) of this repository.

The record of the sportsbooks' favorite is what a prediction of a game has to be measured against. Both halves of it have to be collected as they happen. The free plan of [The Odds API](https://the-odds-api.com/) has no historical data, so a game's line as it stood before tip-off can only be captured before tip-off, and its scores endpoint reaches back three days, so a final score can only be collected in the days after the game.

The package uses the Python standard library only and needs Python 3.11 or newer. On Windows, `zoneinfo` additionally needs the `tzdata` package from PyPI.

## What one run does

1. It reads the clock and works out which [slot](#schedule) it is in.
2. It reads the state file of the last run from the data directory and checks it. Two things can be due. The snapshot is due when the slot is not recorded in the state. The [daily work](#results-and-grading) is due in the [first slot of the day](#the-daily-slot), when the state does not name that slot as the one it was last done for. Either may be asked for only by a run that starts less than [75 minutes](#the-75-minutes) after the slot's start. If nothing is due, or it is too late for what is, the run says so and stops. No request is made.
3. If the daily work is due, it sends one request: `GET https://api.the-odds-api.com/v4/sports/{sport}/scores` with `daysFrom=3`, which lists the games of the last three days and says which of them are completed. For every completed game that is not yet recorded it writes a [result line](#prefixresultsyyyy-mmndjson) with the final score and the verdict on the game's last line from before the start. It rebuilds the [record](#prefixrecordjson) from all result lines, [checks](#checks-before-anything-is-written) what it built and writes it, together with the state, which now names the slot.
4. If the snapshot is due, it sends one request: `GET https://api.the-odds-api.com/v4/sports/{sport}/odds` with `regions=us`, `markets=h2h`, `oddsFormat=decimal` and `commenceTimeFrom` set to the current time, so that games in play are left out.
5. For every game that has not started it computes the [consensus](#the-consensus) of the sportsbooks.
6. It builds the board, the state and the day's history lines, [checks them](#checks-before-anything-is-written), writes them to a temporary directory and moves them into place. The board shows the record and the recent results that the daily work noted in the state.
7. The workflow commits what was written to the `data` branch.

Neither request is repeated within the run, whatever comes of it. The timeout is 20 seconds for connecting and for each wait for data. It is not a limit on the whole request: a response that arrives a little at a time can take longer, and what limits that is the job's 10 minutes.

The daily work and the snapshot are two steps, and each is fetched, built, checked and written on its own. If the scores cannot be had, the snapshot is still taken, and if the odds cannot be had, the results are still recorded. [Exit status](#exit-status) says how such a run ends.

With `--all` there can be more than one sport. The state files of all of them are read first. Then each sport of which something is due goes through steps 3 to 6 on its own, before the next one is started. A sport that fails does not stop the next one and does not undo one that was written.

| Module | What is in it |
| --- | --- |
| `config.py` | The sports to capture and the directory each is written under. |
| `schedule.py` | The six slots, which of them is the daily one, the rule for when a snapshot is due, and for how long a slot may be asked for. |
| `oddsapi.py` | The two requests, for odds and for scores, and their errors. |
| `teams.py` | The 30 team names as the provider spells them, with the NBA's three-letter codes. |
| `feed.py` | What is read from every event the provider lists: its id, its start and its two teams. |
| `consensus.py` | The margin-free home probability of one sportsbook, and the median across sportsbooks. |
| `grading.py` | Which side a line favors, and what became of the line once the game is over. |
| `record.py` | What the results add up to: wins and losses, accuracy with its interval, Brier score and log loss, the bands, the days and the biggest upsets. A pure function. |
| `snapshot.py` | Builds the board, the state and the history lines from a response and the previous state. A pure function. |
| `results.py` | Builds the result lines, the record and the state from a scores response, the previous state and the lines already recorded. A pure function. |
| `validate.py` | The checks on the files. |
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
- `books` is the sorted list of their names when `lo` and `hi` differ. When the two are written as the same number, which is always so for a single sportsbook, the sportsbooks are [counted but not named](#what-is-published-and-what-is-not).
- If no sportsbook can be used the game has no line. That is written as `null`, never as a number.

## Results and grading

Once a day the job asks for the scores of the last three days, which is as far back as the provider goes, and records every game that is over.

### Which games are recorded

- Only an event that the response marks as completed and that has two scores, one for each of its two teams.
- A game is recorded once, by the first daily run that finds it completed. Its line in the results file is never rewritten, so neither a score nor the line it was graded against can change afterwards.
- A completed event that cannot be recorded is left out and reported in the log, and the run goes on. That covers a team that is not one of the 30, an event without a usable id or start, one without two usable scores, one with two equal scores, and one whose start is still to come. Such an event is not remembered: the next daily run looks at it again, for as long as the provider lists it.

### The line a game is graded against

A game is graded against the latest line that the state file holds for it, `games.{id}.latest`. The snapshot replaces that line only before the game starts, so it is the game's last line from before the start. It is not the closing line. It is the line of the last slot before the game. When no slot was missed, that slot is at most three hours before the start of a game that starts after 09:10 in New York.

The scores give a start for each game as well, and it is the start a result line carries. It can differ from the one the odds gave. In the example responses of the provider's [guide](https://the-odds-api.com/liveapi/guides/v4/), a game that is being played or is over has a start to the second, such as `03:10:38`, where a game that is still to come has one on the minute. So the line is held against the start that the scores give:

- A line that was not captured before that start is refused. It may be a price that was quoted while the game was played.
- A line that the state holds for other teams than the scores name, or for the same two teams the other way round, is refused as well. It is the home team's chance, and home would be another team.

A game whose line is refused is recorded without it, as not graded, and the log says why. One doubtful line does not keep a night's results from being recorded.

### The verdict

A line favors the side that it puts at 52% or more.

| `market_verdict` | Meaning |
| --- | --- |
| `favorite_won` | The line had a favorite, and it won. |
| `upset` | The line had a favorite, and it lost. |
| `toss_up` | The home team was between 48% and 52%, so neither side was at 52%. The game counts neither as a win nor as a loss. |
| `not_graded` | The game has no line: no sportsbook quoted it in any snapshot before its start, or the job never saw it before it started, or its line was refused. |

The comparison is made in ten-thousandths, the unit the probabilities are written in. A home team at 0.52 is a favorite and one at 0.48 makes the away team one. At 0.5199 or at 0.4801 the game is a toss-up. A stored home share of 0.532 and a 112 to 104 home win is `favorite_won`. With 0.505 the same game is a `toss_up`.

### The record

The record is rebuilt from every result line at every daily run. It is not added to. The lines are sorted by start and id first, so the same lines give the same file, byte for byte, in whatever order they were recorded.

- **Wins and losses.** A game with a favorite is a win when the favorite won and a loss when it lost. `accuracy` is the wins divided by the games with a favorite.
- **The interval.** `accuracy_interval` is the Wilson score interval at 95%: the lowest and the highest true share of wins that the count is compatible with. With `p` for the accuracy, `n` for the games with a favorite and `z` = 1.959964, it runs from `centre - reach` to `centre + reach`, where

  ```
  centre = (p + z²/2n) / (1 + z²/n)
  reach  = z * sqrt(p(1 - p)/n + z²/4n²) / (1 + z²/n)
  ```

  41 wins in 60 games give 0.5577 to 0.7869. After one game that was won it runs from 0.2065 to 1.
- **Brier score and log loss.** Both are of `p_home` over every game that had a line, toss-ups included. The Brier score is the mean of `(p_home - outcome)²`, with 1 for a home win and 0 for a home loss. The log loss is the mean of `-ln` of the probability that the line gave to what happened, which is `p_home` after a home win and `1 - p_home` after a home loss. Lower is better for both. A line of 0.5 for every game scores 0.25 and 0.6931.
- **The baseline.** `baseline_home` is what picking the home team every time would have won. It is counted over every recorded game, graded or not, because it needs no line. The sportsbooks' wins are counted over the games with a favorite only, so the two are not over the same games.
- **The bands.** The games with a favorite are sorted by the favorite's probability into 52-59, 60-69, 70-79, 80-89 and 90 and up. A band runs from its lower bound up to the next: 0.5999 is in the first and 0.6 in the second. For an away favorite the probability is `1 - p_home`. Each band has its games, the favorites' wins and the mean of the favorites' probabilities. If the lines are right about how sure they are, the share of wins in a band is near that mean.
- **The days.** A game belongs to the New York calendar day it starts on. A game that starts at 22:30 on Tuesday there starts on Wednesday in UTC, and it is a game of Tuesday.
- **The biggest upsets** are the three lost favorites with the highest probability, the highest first.

Every share, score and mean is rounded to four decimals.

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

### The daily slot

The first slot of the day, at 05:10, is also the daily slot: the one in which the [results](#results-and-grading) are recorded, before that slot's snapshot is taken. It comes hours after an evening's games in North America have ended.

The daily work is on record when the state file names the slot in `results.last_slot`. Until then it is due, and it may be asked for exactly as the slot's snapshot may: by a run that starts less than [75 minutes](#the-75-minutes) after 05:10. The triggers at 05:10, 05:40 and 06:10 do. After that the daily work of the day is given up, and no later slot of the day asks for scores.

A day that was given up is made up for by the next daily run, from its one response, because the scores reach back three days. If the three days are counted as 72 hours, a daily run finds the games of the three evenings before it, so two daily runs in a row can be missed without a game being lost, and a third cannot.

`--force` lifts the 75 minutes for the daily work as it does for the snapshot, at any time of day: a forced run does the daily work if that of the last 05:10 slot is not on record, and notes it for that slot. It does not repeat daily work that is on record. Every game is recorded once, so a second scores request for the same morning would cost 2 credits and find nothing to add.

### The 75 minutes

A slot that is not recorded may be asked for only by a run that starts less than 75 minutes after the slot's start. A run that starts later gives the slot up. It prints `Slot ... was not recorded in time; the next slot starts at ...`, makes no request, writes nothing and ends with status 0. `--force` ignores the limit, as it ignores a recorded slot. The [daily work](#the-daily-slot) is held to the same limit: a run that comes too late for it prints `The results that were due in slot ... were not recorded in time for ...; the next daily run reaches back three days.`

The limit is there because the job keeps no record of an attempt that failed. Without it, a failure that lasts would be asked for again at every trigger of the slot: 6, 8 or 16 times, depending on the length of the slot. The triggers of a slot come at its start and every 30 minutes after it, so three of them are inside the 75 minutes: at 0, 30 and 60. The run of any later trigger does not ask, whatever went wrong before it, and also when the job could write or push nothing at all. [What a failure costs](#what-a-failure-costs) says what that comes to.

Why 75. GitHub starts scheduled runs late: in a measurement of four public repositories the median delay was 13 to 21 minutes. The first two triggers of a slot must still fit, and with 75 minutes the second one fits when it starts less than 45 minutes late. Every run that fits is one more request while a failure lasts, and beyond 90 minutes a fourth trigger would fit. The number is `ATTEMPT_WINDOW` in `schedule.py`.

What it costs. A slot is recorded only if a run starts within its first 75 minutes and succeeds. If GitHub starts no run in that time, or every run in it fails, the slot stays empty: no later run takes it. The daily work is the exception, because the next daily run makes up for it.

## Credits

The free plan allows 500 credits a month. The provider's [guide](https://the-odds-api.com/liveapi/guides/v4/) puts the cost of an odds request at one credit per region per market, so each odds request here costs 1, and says that an odds request that returns no events is not charged. It puts the cost of a scores request at 2 when `daysFrom` is given, as it is here.

The plan is one odds request for each sport in each slot and one scores request for each sport a day:

- The regular season: 6 odds requests and 1 scores request a day, which is 8 credits. In a 31-day month that is 248.
- The [preseason rehearsal](#configuration): 8 more a day while it lasts. It ends on 17 October 2026, so it adds at most 64 credits if the job starts on 10 October, and fewer if it starts later.
- A run started by hand costs one odds request per sport when it asks: in the first 75 minutes of a slot that is not recorded, or with `force`. It costs a scores request per sport as well when the daily work is due for it: in the first 75 minutes of the 05:10 slot, or with `force` at any time, as long as the daily work of the last 05:10 slot is not on record. That holds for a dry run too.

Every response reports the credits left, and the job writes them to `state.json`, prints them and puts them in the job summary.

### What a failure costs

A run that fails before a request costs nothing for it, which is why the state file, the key, the day's history file and the results files are checked first. From the request on, two rules bound the cost:

- A run sends one odds request and at most one scores request for a sport and repeats neither, whatever comes of it. The next trigger, half an hour later, is the retry.
- Only a run that starts in the first [75 minutes](#the-75-minutes) of a slot asks for it, and three scheduled runs do. The daily work belongs to the 05:10 slot and follows the same rule.

So a slot costs at most 3 odds requests for each sport, the six slots of a day at most 18, and the daily work at most 3 scores requests a day, whatever goes wrong and for as long as it goes wrong:

| What happens at every trigger | Odds requests for a slot | Odds requests a day | Scores requests a day | Credits a day, if every request is charged |
| --- | --- | --- | --- | --- |
| Nothing goes wrong | 1 | 6 | 1 | 8 |
| The provider refuses: 401, 429 or another 4xx | 3 | 18 | 3 | 24 |
| The provider answers 5xx, or does not answer, or cannot be reached | 3 | 18 | 3 | 24 |
| A 200 that cannot be read | 3 | 18 | 3 | 24 |
| Validation refuses the files of both steps | 3 | 18 | 3 | 24 |
| The files cannot be written | 3 | 18 | 3 | 24 |
| The push is refused, or the run is killed after its requests | 3 | 18 | 3 | 24 |
| The scores fail and the odds answer | 1 | 6 | 3 | 12 |
| The odds fail and the scores answer | 3 | 18 | 1 | 20 |

All numbers are for each sport. They are what `tests/test_pipeline_credits.py` counts. It walks every trigger of a day through the command for each row: with 401 and with 429, with 503 and with a provider that never answers, and with the data directory put back to what it was after each run for the row of the push. The sports are counted one by one because each is [taken on its own](#exit-status). When one sport fails and another answers, the one that answers is written and pushed and costs what the first row says, and only the one that fails is asked for again. The same goes for the two steps of one sport, which is what the last two rows show: the step that answers is recorded at the first trigger and not asked for again.

After the third run the slot is given up and the job waits for the next one. Each run that asked and failed fails the workflow run, which is what tells the owner. The runs that find the slot given up end with status 0.

What the worst case means for the month. The plan for the regular season leaves 252 of the 500 credits of a 31-day month unused. A day on which every slot and the daily work are asked for three times costs 16 more than planned, so there is room for 15 such days. A failure of everything that lasted the whole month would come to 744 credits and would use the 500 up after 20 days.

Two things are not in these numbers:

- They count every request as charged. Whether the provider charges for a request that it refuses or does not answer is not known, so the credits spent can be fewer.
- They count three runs for a slot, which is what the schedule starts in 75 minutes. Any run that starts in that time asks. A run started by hand is one more. So is the last trigger before the slot, if GitHub starts it more than 30 minutes late and then starts the next three nearly on time.

## The files

Each sport is written under its own prefix. `basketball_nba` is under `v1`.

| File | What it is | How it changes |
| --- | --- | --- |
| [`slate.json`](#prefixslatejson) | The board: the upcoming games, the record so far and the recent results. | Replaced by every snapshot. |
| [`state.json`](#prefixstatejson) | What the job remembers between runs. | Replaced by every snapshot and by the daily work. |
| [`history/YYYY-MM-DD.ndjson`](#prefixhistoryyyyy-mm-ddndjson) | One line per game per snapshot. | Only grows. |
| [`results/YYYY-MM.ndjson`](#prefixresultsyyyy-mmndjson) | One line per game that is over. | Only grows. |
| [`record.json`](#prefixrecordjson) | What the results add up to. | Rebuilt from all result lines by the daily work. |

Common to all of them:

- A time is in UTC, to the second: `2026-10-20T22:10:41Z`. The exceptions are `slot`, `next_due` and `last_slot`, which are slot ids, and `since` and `day`, which are New York calendar dates.
- A probability is the home team's chance of winning unless its name says otherwise, rounded to four decimals. A line's probability is always strictly between 0 and 1: a value that would round to 0 or 1 is written as 0.0001 or 0.9999.
- A team is its three-letter code, such as `BOS`. The table is in `teams.py`.
- The JSON files are written with sorted keys, a two-space indent and a final newline.

`schema` is 1 in the three JSON files, and it stays 1 when a field is added. A later version of the job may add fields to any of the files, and to new lines of the results files. A reader must ignore the fields it does not know. The formats of the history files and of the results files are final in what they hold now, because those files only grow: a line that is written is never changed.

### `{prefix}/slate.json`

The board: the upcoming games as of the latest snapshot, with the record so far and the results of the last days. Replaced by every snapshot.

```json
{
  "games": [
    {
      "away": "GSW",
      "commence_time": "2026-10-22T02:00:00Z",
      "home": "LAL",
      "id": "7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e",
      "line": {
        "books": [
          "Book A",
          "Book B",
          "Book C"
        ],
        "captured_at": "2026-10-21T22:10:38Z",
        "hi": 0.4359,
        "lo": 0.4177,
        "n": 3,
        "p_home": 0.4275
      },
      "open": {
        "at": "2026-10-20T22:10:41Z",
        "p_home": 0.4359
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
  "generated_at": "2026-10-21T22:10:38Z",
  "next_due": "2026-10-21T21:10-04:00",
  "recent_results": [
    {
      "away": "NYK",
      "away_pts": 104,
      "commence_time": "2026-10-20T23:10:38Z",
      "home": "BOS",
      "home_pts": 112,
      "id": "5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10",
      "market": {
        "at": "2026-10-20T22:10:41Z",
        "hi": 0.6542,
        "lo": 0.6265,
        "n": 3,
        "p_home": 0.6429
      },
      "market_verdict": "favorite_won",
      "recorded_at": "2026-10-21T09:10:07Z"
    }
  ],
  "record": {
    "market": {
      "losses": 0,
      "wins": 1
    }
  },
  "schema": 1,
  "slot": "2026-10-21T18:10-04:00",
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
| `record` | The record so far: under `market`, the `wins` and the `losses` of the sportsbooks' favorite, as in [`record.json`](#prefixrecordjson). `null` until the daily work has been recorded once. |
| `recent_results` | The [result lines](#prefixresultsyyyy-mmndjson) of the games that started less than eight days before `generated_at`, sorted by start time and then by id. Each is the object that is in the results file. Empty until a result has been recorded. |

`record` and `recent_results` are what the daily work last noted in the state. The snapshot copies them and drops the results that have grown older than eight days. It reads no results file, so it can be taken whatever state those files are in. Normally the daily work and the 05:10 snapshot are done by the same run, and the board has the night's results at once. When the scores fail at 05:10 and arrive at a later trigger, the board gets them with the next snapshot, which is the one of 09:10.

### `{prefix}/state.json`

What the job remembers between runs.

```json
{
  "credits": {
    "last": 1,
    "remaining": 431,
    "used": 69
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
    "7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e": {
      "away": "GSW",
      "commence_time": "2026-10-22T02:00:00Z",
      "first": {
        "at": "2026-10-20T22:10:41Z",
        "p_home": 0.4359
      },
      "home": "LAL",
      "latest": {
        "at": "2026-10-21T22:10:38Z",
        "hi": 0.4359,
        "lo": 0.4177,
        "n": 3,
        "p_home": 0.4275
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
  "last_run_at": "2026-10-21T22:10:38Z",
  "last_slot": "2026-10-21T18:10-04:00",
  "results": {
    "last_run_at": "2026-10-21T09:10:07Z",
    "last_slot": "2026-10-21T05:10-04:00",
    "recent": [
      {
        "away": "NYK",
        "away_pts": 104,
        "commence_time": "2026-10-20T23:10:38Z",
        "home": "BOS",
        "home_pts": 112,
        "id": "5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10",
        "market": {
          "at": "2026-10-20T22:10:41Z",
          "hi": 0.6542,
          "lo": 0.6265,
          "n": 3,
          "p_home": 0.6429
        },
        "market_verdict": "favorite_won",
        "recorded_at": "2026-10-21T09:10:07Z"
      }
    ],
    "record": {
      "market": {
        "losses": 0,
        "wins": 1
      }
    }
  },
  "schema": 1
}
```

| Field | Meaning |
| --- | --- |
| `schema` | 1. |
| `last_slot` | The id of the last slot of which a snapshot is recorded. The next run compares its own slot with this. `null` when the daily work was recorded before any snapshot. |
| `last_run_at` | When that snapshot's response was received. `null` with `last_slot`. |
| `credits` | The quota headers of the last response the job recorded something from, which can be one of odds or one of scores: `remaining` (`x-requests-remaining`), `used` (`x-requests-used`) and `last` (`x-requests-last`, the cost of the request). `null` for a header that was missing. |
| `games` | One entry per game, keyed by the provider's id. |
| `games.{id}.commence_time`, `home`, `away` | As in the board, as of the last snapshot that listed the game. |
| `games.{id}.first` | The opening line: `p_home` and `at`. `null` until the game has a line. |
| `games.{id}.latest` | The most recent line: `p_home`, `lo`, `hi`, `n` and `at`. `null` until the game has a line. |
| `results` | What the daily work notes. `null` until it has been recorded once. A state file from before the field existed does not have it, and the job continues from such a file. |
| `results.last_slot` | The id of the 05:10 slot that the daily work was last recorded for. The next run compares the latest 05:10 slot with this. |
| `results.last_run_at` | When that run's scores response was received. |
| `results.record` | The record as the board shows it. |
| `results.recent` | The result lines of the games that started less than eight days before the daily work or the last snapshot, whichever came later. The board shows them. |

The rules the state follows:

- The first line seen for a game is kept as `first` and never replaced.
- `latest` is replaced only by a snapshot taken before the game starts, and only when the game has a line in that snapshot. Once a game has started, `latest` is its last line from before the start, which is what the game is graded against.
- A game stays until 14 days after its start and is then removed.
- A game that is missing from a response stays as it is.
- `results` is written by the daily work, from the results files and not from what was in the state before, and carried from one snapshot to the next. A result leaves `recent` eight days after the start of its game.

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

### `{prefix}/results/YYYY-MM.ndjson`

One file per month, named after the UTC month in which the games in it started. The daily work adds one line for every game that is over and not yet in a file. The first line below is from the daily run of 21 October, and the other two are what the run of 22 October could add: an upset, and a game the job had no line for.

```
{"id":"5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10","commence_time":"2026-10-20T23:10:38Z","home":"BOS","away":"NYK","home_pts":112,"away_pts":104,"recorded_at":"2026-10-21T09:10:07Z","market":{"p_home":0.6429,"lo":0.6265,"hi":0.6542,"n":3,"at":"2026-10-20T22:10:41Z"},"market_verdict":"favorite_won"}
{"id":"3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c","commence_time":"2026-10-22T01:10:12Z","home":"DEN","away":"DAL","home_pts":101,"away_pts":110,"recorded_at":"2026-10-22T09:10:07Z","market":{"p_home":0.7021,"lo":0.6897,"hi":0.7143,"n":4,"at":"2026-10-21T22:10:38Z"},"market_verdict":"upset"}
{"id":"1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a","commence_time":"2026-10-22T01:40:55Z","home":"UTA","away":"PHX","home_pts":120,"away_pts":110,"recorded_at":"2026-10-22T09:10:07Z","market":null,"market_verdict":"not_graded"}
```

| Field | Meaning |
| --- | --- |
| `id` | The provider's id for the game, the same as in the board, the state and the history. |
| `commence_time` | The start of the game as the scores give it, which can differ from the scheduled start that the board had. |
| `home`, `away` | Team codes. |
| `home_pts`, `away_pts` | The final score: two whole numbers that are not equal. |
| `recorded_at` | When the scores response was received from which the game was recorded. |
| `market` | The [line the game is graded against](#the-line-a-game-is-graded-against): `p_home`, `lo`, `hi`, `n` and `at`, as they were in `games.{id}.latest` of the state. `at` is before `commence_time`. `null` when the game has no such line. |
| `market_verdict` | [`favorite_won`, `upset`, `toss_up` or `not_graded`](#the-verdict). |

Each line is one JSON object without spaces, with these nine fields first and in this order. A later version may add fields after them to the lines it writes, for example a model's probability and the verdict on it, so a reader has to take lines with and without such fields. Lines are only added at the end, in order of start within one run. A file is never rewritten or shortened, and a game is in the files once.

### `{prefix}/record.json`

What the result lines add up to. [The record](#the-record) says how each number is worked out. This is the record after the daily run of 21 October, with the one game it recorded:

```json
{
  "baseline_home": {
    "games": 1,
    "wins": 1
  },
  "by_day": [
    {
      "day": "2026-10-20",
      "games": 1,
      "market": {
        "losses": 0,
        "not_graded": 0,
        "toss_ups": 0,
        "wins": 1
      }
    }
  ],
  "games": 1,
  "market": {
    "accuracy": 1.0,
    "accuracy_interval": [
      0.2065,
      1.0
    ],
    "bands": [
      {
        "band": "52-59",
        "games": 0,
        "mean_p_favorite": null,
        "wins": 0
      },
      {
        "band": "60-69",
        "games": 1,
        "mean_p_favorite": 0.6429,
        "wins": 1
      },
      {
        "band": "70-79",
        "games": 0,
        "mean_p_favorite": null,
        "wins": 0
      },
      {
        "band": "80-89",
        "games": 0,
        "mean_p_favorite": null,
        "wins": 0
      },
      {
        "band": "90+",
        "games": 0,
        "mean_p_favorite": null,
        "wins": 0
      }
    ],
    "biggest_upsets": [],
    "brier": 0.1275,
    "games": 1,
    "log_loss": 0.4418,
    "losses": 0,
    "not_graded": 0,
    "toss_ups": 0,
    "wins": 1,
    "with_line": 1
  },
  "schema": 1,
  "since": "2026-10-20",
  "sport": "basketball_nba"
}
```

| Field | Meaning |
| --- | --- |
| `schema` | 1. |
| `sport` | The sport's key in The Odds API. |
| `since` | The day of the first game in the record. `null` when there is no game yet. |
| `games` | The games recorded. |
| `market` | How the sportsbooks' line did. |
| `market.games` | The games in which the line had a favorite, which is `wins` plus `losses`. |
| `market.wins`, `market.losses` | The favorites that won, and the ones that lost. |
| `market.accuracy` | `wins` divided by `market.games`. `null` when no game had a favorite. |
| `market.accuracy_interval` | The lower and the upper bound of the Wilson 95% interval of the accuracy. `null` with the accuracy. |
| `market.toss_ups` | The games whose line had no favorite. |
| `market.not_graded` | The games without a line. |
| `market.with_line` | The games with a line, favorite or not: the games that `brier` and `log_loss` are of. |
| `market.brier`, `market.log_loss` | The Brier score and the log loss of `p_home`. `null` when no game had a line. |
| `market.bands` | Always the five bands, in order. Each has its `band`, the `games` whose favorite was in it, the `wins` among them and `mean_p_favorite`, the mean probability of those favorites, which is `null` for a band without games. |
| `market.biggest_upsets` | Up to three lost favorites, the one with the highest probability first, and among equals the earlier game. Each has the game's `id`, `commence_time`, `home`, `away`, `home_pts` and `away_pts`, the team code of the `favorite` and its probability, `p_favorite`. |
| `baseline_home` | The home team every time: the `games` recorded and the `wins` of the home team among them. |
| `by_day` | One entry for each day that has a game, in order: the `day`, its `games`, and under `market` the day's `wins`, `losses`, `toss_ups` and `not_graded`. |

An entry of `biggest_upsets`, for the second line of the results file above:

```json
{
  "away": "DAL",
  "away_pts": 110,
  "commence_time": "2026-10-22T01:10:12Z",
  "favorite": "DEN",
  "home": "DEN",
  "home_pts": 101,
  "id": "3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c",
  "p_favorite": 0.7021
}
```

The file is written at every daily run, also when no game was added, and then comes out as it was.

### What is published and what is not

The provider's [terms](https://the-odds-api.com/terms-and-conditions.html) do not allow its data to be redistributed as a data product of its own, which includes downloadable files that are meant to be a source of raw data for others. They do allow the data to be stored and displayed, and values derived from it to be calculated and displayed.

What the files take from the provider as it came is little: the id of each game, its start and its two teams, which say what a line or a result is about, and the two final scores of a game that is over. Everything else in them is worked out by the job.

Of the odds, the files hold derived values only. There is no response and no price in them, and no list of what each sportsbook quoted: the names in `books` say which sportsbooks went into a consensus and nothing more.

When only one sportsbook quotes a game, the consensus is that one sportsbook's probability with its margin removed. The line is published all the same, with `n` set to 1, but `books` is left empty, so that no file puts a number to the name of a single sportsbook. The two prices behind the number are not published and cannot be worked out from it. With two sportsbooks, `lo` and `hi` are their two probabilities and both are named, without saying which is whose. When all the sportsbooks of a game give the same probability, so that `lo` and `hi` are written as the same number, their names would say what each of them gave. `books` is left empty then too, whatever `n` is.

Of the scores, the files hold the final score of each completed game as the provider gave it, because a result cannot be told in derived values. Nothing else of a scores response is kept: no score of a game that is being played, and no time of the provider's last update. A final score is a public fact, and it is recorded here so that the record can be checked game by game. It is still taken from the provider and published in a file that anyone can download. Whether the provider's terms are meant to cover that has not been asked, and [what has not been checked](#what-has-been-checked-and-what-has-not) says so.

No real odds and no real scores are in this repository. The tests and the fake server use invented games, prices and scores.

## Checks before anything is written

`validate.py` returns a list of problems. If the list is not empty, that step of the sport ends with status 2 and nothing of it is written.

The snapshot:

- Every probability is a number strictly between 0 and 1, and `lo <= p_home <= hi`.
- `n` is a whole number of at least 1. The board names as many sportsbooks as it counts, and none when it counts one or when `lo` equals `hi`.
- Every team code is one of the 30.
- Every game on the board starts after the snapshot time.
- History only grows: the content already in the day's file must be the beginning of the new content, the existing file must end with a newline, and every added line must be a complete record with the six fields in order.
- Every time is in the one UTC format, and `schema` is 1.
- The record on the board is `null` or holds whole numbers for wins and losses, and every recent result is a sound result line.

The daily work:

- The two scores of a result are whole numbers, not negative and not equal.
- The line of a result was captured before its game started, and it is a sound line: probabilities, count and time as above.
- The verdict is one of the four, and it is the one that the line and the score make.
- A result was recorded after its game started.
- Results only grow: the content already in each results file must be the beginning of its new content and end with a newline, and no existing line changes. Every line begins with the nine fields in order. A line is in the file of the month its game started in, and no game is in the files twice.
- The record's totals equal a recount of the result lines: the games, the wins and the losses, the toss-ups and the games not graded, the games with a line, the home team's wins, the sums over the five bands and the sums over the days. The accuracy is the wins divided by the games with a favorite.
- The wins and the losses that the state notes for the board equal the same recount.

The files that a run continues from go through the same checks when they are read, before a request is spent on them. A state file that fails them, or that is not JSON, stops its sport. The day's history file stops the snapshot, and the results files stop the daily work. For the results files that means every line of every file, the old ones too, because the record is rebuilt from all of them.

An event in a response that cannot be used is a different matter. It is left out and reported in the log, and the run goes on. That covers a team name that is not one of the 30, which happens in the preseason when an NBA team plays a club from another league, and an event without a usable id or start time. For the scores it also covers a completed event [without two scores that can be recorded](#which-games-are-recorded).

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | What was due was done, or nothing was due, or the slot was [given up](#the-75-minutes). |
| 1 | Bad arguments or settings: for example `ODDS_API_KEY` is not set. Also when files could not be written. |
| 2 | Validation failed. |
| 3 | The provider refused a request: HTTP 401, 429, or any other answer that is neither a success nor a 5xx. |
| 4 | The provider gave no usable answer: a network error, a timeout, a 5xx, or a response that could not be read as a list of events. |

No request is repeated within a run, whichever of these it ends with.

Each sport is taken on its own, and so is each of its two steps, the daily work and the snapshot. For a step that fails nothing is written. A step that was written stays written when another one fails, before it or after it, for the same sport or for another, and the next trigger then finds it recorded and asks for the failed one only. So when the scores cannot be had, the snapshot of the slot is still taken, and when the odds cannot be had, the results are still recorded. The run ends with the status of the first failure, its messages name each sport that failed and say what of it was not written, and it reports `changed=true` because there is something to push.

There is one way for a failed step to leave something behind. Its files are moved into place one after the other, the state file last: for a snapshot the day's history, the board and the state, and for the daily work the results files, the record and the state. If a move fails after an earlier one has worked, the files moved before it are already the new ones, although the message says that nothing was written. The state file is still the old one, so the step is not recorded and a later run in time takes it again. A snapshot then adds its own lines after those in the history. The daily work finds the games in the results file already recorded, adds none of them twice and rebuilds the record. If something else was written in the same run, the workflow commits the moved files with it.

A message never contains the request URL or the key. For a refusal it gives the status and the provider's error code, as in `HTTP 401 (INVALID_KEY)`. An error that nobody foresaw while the answer was fetched and read ends with status 4 as well and is named by its class only, as in `the response could not be read (RecursionError)` for a body that is nested too deep.

An error that nobody foresaw in the daily work, which would be a bug in it, does not end the run where it happens. The snapshots that are due are taken first, for that sport and for the others, because a snapshot cannot be taken later. Then the error is raised, and the run ends with a traceback and status 1.

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
| `--force` | Take a snapshot even if the current slot is already recorded, or started 75 minutes ago or more. Do the daily work as well, at any time of day, if that of the last 05:10 slot is [not on record](#the-daily-slot). |
| `--dry-run` | Fetch and validate, but write nothing. It makes a request only for what is due, so in a slot that is recorded, or that started 75 minutes ago or more, it makes none unless `--force` is given too. |

The key is read from the environment variable `ODDS_API_KEY`. When `GITHUB_OUTPUT` is set, as it is in GitHub Actions, the command also appends these to the file it names:

| Output | Meaning |
| --- | --- |
| `changed` | `true` when something was written, otherwise `false`. Always there. |
| `slot` | The id of the slot. Always there. |
| `results`, `results_not_graded`, `results_dropped` | The counts of the daily work, as totals over the sports it was done for in this run: the results recorded, how many of them have no line, and the completed events that were left out. Left out when it was done for none. |
| `games`, `with_line`, `dropped` | The counts of the snapshot, as totals over the sports it was taken for in this run. Left out when it was taken for none. |
| `credits_remaining`, `credits_used`, `credits_spent` | From the quota headers: the first two from the last response, the third added up over the steps that were done. Left out when none was. |
| `written` | The counts for each prefix that was written, in the order they were written, as in `v1 9 results and 12 games, v1-dryrun 3 games`. Left out when nothing was written. |
| `failed` | The sports of which a step failed. Left out when none did. |
| `given_up` | The sports whose slot was not recorded in time. Left out when there is none. |
| `results_given_up` | The sports whose daily work was not recorded in time. Left out when there is none. |

### Against the fake server

`tests/fake_odds_api.py` is a local stand-in for the API with invented games, prices and scores. It needs no key and no network:

```bash
python tests/fake_odds_api.py --port 8765 &

export ODDS_API_BASE_URL=http://127.0.0.1:8765
export ODDS_API_KEY=any-value
python -m pipeline snapshot --all --data-dir /tmp/odds-data --force  # writes the files
python -m pipeline snapshot --all --data-dir /tmp/odds-data          # "Not due", no request
python -m pipeline snapshot --all --data-dir /tmp/odds-data --force  # a second snapshot
```

The first command is forced because, without `--force`, a run takes a slot only in its first 75 minutes. At any other time of day it would print that the slot was not recorded in time and make no request.

The first forced run does the daily work as well, because none is on record. The fake server lists two games of the regular season and one of the preseason as over, and a second preseason game against a team that is not one of the 30, which is dropped. The three are written to `results/` and counted in `record.json`. They come out as `not_graded`, because the server has them over from the start and no line was ever stored for them. `python -m pytest tests/test_pipeline_daily.py` runs the command through an evening and the morning after it, with lines that are graded.

The second forced run asks for odds only, because the daily work is on record by then. The fake server moves its prices a little with each request, so after that run the history file has two lines per game, `latest` has changed and `first` has not.

`ODDS_API_BASE_URL` exists for this purpose only. It is accepted when it names a server on the local machine (`127.0.0.1`, `localhost` or `::1`) and refused otherwise, so that a stray setting cannot send a real key somewhere else.

## Configuration

`config.py` lists two sports:

| Sport key | Prefix | Captured |
| --- | --- | --- |
| `basketball_nba` | `v1` | Always. |
| `basketball_nba_preseason` | `v1-dryrun` | Until 17 October 2026, New York date, that day included. |

The preseason entry is a rehearsal. The regular season starts on 20 October 2026, and the scores request and the grading have to be tried on real games before then. The entry gets the same daily work as the regular season. It is written under its own prefix so that it stays apart from the record, and the entry is to be deleted after opening night.

## The workflow

`.github/workflows/pipeline.yml`, named `Odds snapshot`, runs on the schedule above and by hand (`workflow_dispatch`, with the inputs `force` and `dry_run`). The inputs are the command's `--force` and `--dry-run`. A dry run in a slot that is already recorded, or that started 75 minutes ago or more, makes no request unless `force` is set as well.

- **One run at a time.** The runs share a concurrency group, and a run in progress is not cancelled.
- **Permissions.** The workflow's token can only read the repository. The one job is given `contents: write`, because it pushes to the `data` branch. The two actions it uses are the ones the CI workflow uses, pinned to the same commits.
- **The API key** is the repository secret `ODDS_API_KEY`. It is in the environment of the step that runs the pipeline and of no other step. The pipeline never prints it, and the workflow does not turn on shell tracing.
- **The data branch** is checked out into a second working tree, `data-branch/`, with plain git commands. Fetching needs no credentials. For the push, git is given a credential helper that reads the workflow's token from the environment, so the token is not written to disk.
- **The first run.** If there is no `data` branch yet, the job starts one that shares no history with `main`. Its first commit holds the two files in `.github/data-branch/`: a README for the branch, and `nba-predictions-app/vercel.json` with `{"git": {"deploymentEnabled": false}}`. Vercel builds the `nba-predictions-app` folder of every branch that is pushed to this repository, and that [setting](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled) tells it not to deploy this one. The job does not bring the two files up to date afterwards. When the README for the branch changes on `main`, as it did when the daily work was added, it has to be copied to the `data` branch by hand.
- **The commit.** When the pipeline reports `changed=true` and the run is not a dry run, the job commits everything in the data tree as `github-actions[bot]` and pushes to `data`. The message gives the count for each prefix that was written, as in `Snapshot 2026-10-20T18:10-04:00: v1 12 games, v1-dryrun 3 games`. A run that did the daily work puts the results it added first, as in `Snapshot 2026-10-21T05:10-04:00: v1 9 results and 12 games`, also when it added none. A run that recorded results and took no snapshot, because the scores had failed at the trigger before it, is committed under the same first word: `Snapshot 2026-10-21T05:10-04:00: v1 9 results`. The job never pushes to `main` and never forces. The push is made with the workflow's own token, and GitHub [does not start workflow runs](https://docs.github.com/en/actions/concepts/security/github_token) for events caused by that token, so CI does not run on these commits.
- **One step failed, another was written.** The pipeline step then ends with a failure and reports `changed=true`. The commit step has `!cancelled()` in its condition, so it runs all the same and pushes what was written. The job still ends as failed, because one of its steps failed, and that is what tells the owner.
- **A push that is refused.** If the branch has moved in the meantime, or the remote turns the push away for another reason, the run fails and nothing of it is recorded. The next run asks again, if it starts within the slot's 75 minutes.
- **The summary** of each run says what was recorded: the results, when the daily work was done, and the games of the snapshot, when one was taken. It gives the credits that are left, names the sports that failed, and says when a slot or its daily work was given up.

## Tests

```bash
python -m pytest tests/test_pipeline_*.py
```

They need pytest and nothing else, make no request to The Odds API, and use a dummy key and invented games, prices and scores.

| File | What it covers |
| --- | --- |
| `tests/test_pipeline_teams.py` | The team table against the web app's logo table, the scoreboard fixture and `nba_api`'s list of teams. The last check is skipped when `nba_api` is not installed. |
| `tests/test_pipeline_consensus.py` | The margin-free share, the median, the range and the count, and every way a sportsbook's quote can be unusable. |
| `tests/test_pipeline_grading.py` | The favorite from 52% on, the toss-up between 48% and 52%, and the four verdicts. |
| `tests/test_pipeline_record.py` | The record's arithmetic against figures worked out by hand: the Wilson interval of 41 wins in 60 games, a Brier score and a log loss of four games, which band a favorite falls in, the New York day of a game, the three biggest upsets, and that the same lines give the same bytes in any order. |
| `tests/test_pipeline_results.py` | What a scores response becomes: a stored home share of 0.532 and a 112 to 104 home win is a favorite that won, 0.505 is a toss-up, no stored line is not graded, a line captured at or after the start is refused, only a completed game with two scores that differ is recorded and only once, two missed daily runs are caught up from one response, and what the run notes in the state. |
| `tests/test_pipeline_schedule.py` | The slot table on 31 October, 1 November and 2 November 2026, across the end of daylight saving time, the cron triggers walked over those three days, the 75 minutes: which triggers of a slot start in time, and which slot is the daily one at each moment of those days. |
| `tests/test_pipeline_timestamps.py` | The timestamp format. |
| `tests/test_pipeline_snapshot.py` | The three outputs for a response, that a single sportsbook is not named and neither are several that all give the same probability, and the state rules: the opening line is kept, a started game's line is never replaced, a game leaves after 14 days, an unusable event is dropped and reported, and what a daily run noted is carried over and shown on the board for eight days. |
| `tests/test_pipeline_validate.py` | Each check, by breaking one thing in a valid snapshot, in a valid result, in a results file or in the record that was built from the results. |
| `tests/test_pipeline_store.py` | The file formats on disk and the paths, that a result line is read back as it was written, that a write which fails before any file is moved leaves the data directory as it was, the order of the moves, and that the temporary directory of a killed run is removed. |
| `tests/test_pipeline_oddsapi.py` | The two requests against the fake server, for odds and for scores: the parameters of each, and for both of them that a request is sent once whatever comes of it, the refusals, a redirect, a body that is nested too deep, and that no error message or traceback holds the key or the URL. |
| `tests/test_pipeline_cli.py` | The snapshot from end to end: a first run, a second run in the same slot, three slots of one evening, 401, 429 and 503, a validation failure, files that cannot be written, a slot just inside and just outside its 75 minutes, `--dry-run`, `--force`, and `--all` with two sports of which one fails. After every run it looks for the dummy key in the output and in the files. |
| `tests/test_pipeline_daily.py` | The daily work from end to end, with lines taken on an evening and scores asked for the next morning: the result lines, the record, the state and the board, a second run that changes nothing, the next morning's run that only adds, two missed daily runs caught up from one response, scores that fail while the snapshot is taken and the reverse, scores that fail all morning and are asked for three times, a run that is too late, `--force`, `--dry-run`, an event that is dropped, a line that is refused, two months in two files, each check that refuses the daily work, a write that fails halfway, files from before there was any daily work, and a bug in the daily work that must not cost the snapshot. After every run it looks for the dummy key in the output and in the files. |
| `tests/test_pipeline_credits.py` | The bound on requests. Every cron trigger of a day is walked through the command, on an ordinary day and on the days of 25 and of 23 hours, once for each way a run can end, including the scores failing while the odds answer and the reverse. The odds requests are counted for each slot, each sport and the day, and the scores requests for each sport and the day: one when the daily work succeeds, three when it does not, all of them in the day's first slot. A day as planned is priced as the provider's guide prices it and comes to 8 credits for a sport. |
| `tests/test_pipeline_workflow.py` | The workflow file, read as text: every slot starts on a cron trigger, the 75 minutes are given as `schedule.py` has them, the actions are pinned to the commits CI uses, the token is read-only outside the job that pushes, the checkout keeps no credentials, the key goes to one step, runs wait for each other and none is cancelled, the job is limited to 10 minutes, what was written is pushed although the pipeline step failed and that step still fails the job, the commit message has the count for each prefix, every output that the workflow reads is one that the command writes, the summary has a line for the results and one for results that were given up, and the only push is an unforced one to `data`. |

## What has been checked, and what has not

Checked on 10 October 2026, with the daily work in place:

- The tests above pass on Python 3.11 and 3.12 in Linux containers and on Python 3.13 and 3.14 on macOS. The whole test suite, with the repository's requirements installed, passes on Python 3.12 on Linux, which is what CI runs.
- Each test that came with the daily work was run against the code with the behaviour it names broken, on a scratch copy, and failed. That was done with 191 single changes. Among them: the scores asked for with another number of days or on the path of the odds, a second scores request after a failure, the favorite from 51% or from 53%, the away team's probability taken from 1 in floating point, the interval at another level or without its second term, the Brier score without the square, a band that starts a point later, the day taken in UTC, each check of the results and of the record switched off, a result kept on the board for exactly eight days, a game recorded a second time, a line captured at the start accepted, the scores asked for in every slot or without the limit of 75 minutes, daily work repeated by `--force`, the state file moved into place first, and a bug in the daily work that ends the run before the snapshot.
- The shell steps of the workflow were run through a week of mornings on a developer machine and in a Linux container, against a temporary bare git repository standing in for `origin` and against the fake server, which listed invented games as still to come, as being played or as over, according to the clock that was set for each run. The runs were: the run that starts the branch, in an evening slot. The day's first slot, which records the results and takes the snapshot in one commit. A second trigger in that slot, and two later slots of the day. A morning on which the scores fail, so that the snapshot is pushed and the job fails, and the next trigger, which pushes the results alone. A morning on which the scores are refused at all three triggers and then given up, and a forced dry run later that day. The next morning's run, which records two nights from one response. A push that the remote refuses, and the trigger after it. A forced run with the daily work on record, which asks for no scores. A day with one sport left. In every run the requests, the commit message, the job summary and the files on the branch were as this file describes them, and the results files only grew.
- The rehearsal of the snapshot from before the daily work was run again on both, with one expectation changed: the commit of a day's first slot now names results. Its runs were: a dry run before there is a `data` branch, the first run that starts the branch, a second trigger in the same slot, a second snapshot in the next slot that adds to the history, one sport failing while the other is pushed and the job fails, the three triggers after that, a push that the remote refuses at each trigger of a slot until the slot is given up, the slot after it, dry runs with and without `force`, a forced run in a slot that was too old, a refusal by the provider, a push after the branch had moved, and a remote that could not be reached.
- A data directory that the job had written as it was before the daily work, with a state file without `results`, was continued from by the job as it is now, and a game was graded against a line that the earlier code had stored.
- `actionlint` 1.7.12, run from its container image, reports nothing for the workflow file. That image runs `shellcheck` on the scripts of the steps.
- The three commands under [Against the fake server](#against-the-fake-server) were run as written, and the examples of the files in this README were produced by the command and its builders from invented games.

Checked on 10 October 2026 for the snapshot as it was before the daily work was added, and not repeated since:

- Every cron trigger of 31 October to 2 November 2026, when the clocks go back, and of 15 to 18 October 2026, when two sports are captured until the 17th, was walked through the command in a Linux container, with the system clock set for each run and a local stand-in for the provider, once for each way a snapshot can fail. Two of those ways needed more than a stand-in: validation was made to refuse the files by a fault put into the builder, and the provider that never answers, with the command waiting its real 20 seconds each time, was walked for 31 October to 2 November and for 16 October only. The walks were repeated with every run starting 5, 20, 40 or 70 minutes late, with triggers that never run, and with one sport failing while the other answers. No sport was asked for its odds more than 3 times for a slot, or more than 18 times for the six slots of a day. With a run by hand in every slot, or with the trigger before every slot starting 31 minutes late, each slot was asked for 4 times, and for 5 times when the two triggers before it both started late. Those are the runs that the numbers of [What a failure costs](#what-a-failure-costs) leave out. The scores requests have been counted by the tests only, which give the command its clock instead of setting the system's.
- The steps of the workflow that check the data branch out and push to it, whose commands have not changed since, were run against a local git server over HTTP that asks for a password on a push, to check the credential helper, with a token, without one and with a wrong one.
- The builder, the validator and the command were run on one real response of the `basketball_nba` odds endpoint, captured on 9 October 2026 and served by the fake server. All 46 games in it were recorded and none was dropped. 23 of them were quoted by a single sportsbook and were written without a name. That response is not kept in the repository.

What is known of the job on GitHub, on 10 October 2026:

- The workflow was started by hand once, with `force` and `dry_run`, before the daily work was added. The log of that run shows one odds request for each of the two sports and nothing written: 46 games of the regular season and 8 of the preseason, each with a line, and none dropped.
- By 20:08 UTC there was a `data` branch, so a scheduled run of the snapshot had written and pushed by then. What is on the branch was not looked at for this list.

Not checked:

- The daily work has not run on GitHub, and no scores request has been sent to The Odds API. No scores response of the provider has been seen. The job is written to the provider's guide, whose example response is the only one known here.
- Whether the scores endpoint answers for `basketball_nba_preseason` is not known. The rehearsal under `v1-dryrun` is there to find out before opening night.
- How the provider counts the three days of `daysFrom` has not been seen. [The daily slot](#the-daily-slot) says what follows if it is 72 hours.
- That the scores give a finished game another start than the odds did is taken from the examples of the provider's guide. It has not been seen on a real game.
- Whether the provider's terms are meant to cover a file of final scores on a public branch has not been asked. [What is published and what is not](#what-is-published-and-what-is-not) says what the files hold.
- The rehearsal applies the conditions of the steps by hand. That GitHub runs the commit step after a failed pipeline step, as `!cancelled()` says it will, has not been seen.
- How late GitHub starts the scheduled runs of this repository is not known. The 13 to 21 minutes behind the [75 minutes](#the-75-minutes) were measured on four other repositories.
- Whether Vercel leaves the `data` branch alone has not been looked at.
- A refusal by the provider has not been seen. The job looks for the provider's error code in a field named `error_code` of the error body. If the field has another name, the message gives the HTTP status alone. Whether a refused or an unanswered request is charged is not known either, nor whether a scores request is charged when no game in its answer is completed.

## Limits

- The job knows nothing about the calendar. Out of season it would keep asking six times a day for odds and once for scores, and commit empty boards. Disable the workflow when the season is over.
- A snapshot is only as punctual as GitHub's scheduler. A game that starts between a slot's start and a late run is missing from that snapshot.
- A slot in which no run starts within [75 minutes](#the-75-minutes), or in which every such run fails, is not recorded, and nothing takes it later. That is the price of the bound on requests.
- That bound counts on no more than three runs starting in a slot's first 75 minutes. [What a failure costs](#what-a-failure-costs) names the two ways a fourth can.
- GitHub [disables scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) in a public repository after 60 days without repository activity.
- A game is identified by the provider's event id. If the provider gave a rescheduled game a new id, it would be recorded as a new game.
- An event that cannot be used is left out and reported, and the run succeeds. If the provider changed the shape of every event, the runs would go on succeeding with empty boards and without results. The numbers of dropped events in the log and in the job summary are where that would show.
- A game is graded against the line of the last slot before its start, not against the closing line. That line can be hours old, and older when a slot was missed.
- A game the job has no line for is recorded and not graded. That is every game that started before the job took its first snapshot, and every game that was on no board before it started.
- A result is taken as the provider gives it at the first daily run that finds the game completed, and it is never corrected. If the provider changed a score afterwards, the files would keep the first one.
- A game is recorded only while the scores still list it, which is three days. If the daily work fails or is missed for longer than the scores reach back, the games of the nights in between are never recorded. The files do not say that a game is missing.
- A game that the provider never marks as completed is never recorded.
