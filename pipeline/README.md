# Odds snapshots, results and forecasts (`pipeline/`)

A scheduled job that does three things for NBA games. Six times a day it records what US sportsbooks imply about each upcoming game: the home team's chance of winning, with the sportsbooks' margin taken out. Once a day it records how the games that are over ended and grades each of them: did the side that the sportsbooks favored before the game win? In the same daily run it forecasts the games of the day with [two models](#the-models) of its own, which use nothing but the schedule and the final scores of the season, and grades their forecasts of the games that are over by the same rule. A GitHub Actions workflow runs it and commits the result to the [`data` branch](https://github.com/shubhroses/nba-game-prediction/tree/data) of this repository.

The record of the sportsbooks' favorite is what a prediction of a game has to be measured against. Both halves of it have to be collected as they happen. The free plan of [The Odds API](https://the-odds-api.com/) has no historical data, so a game's line as it stood before tip-off can only be captured before tip-off, and its scores endpoint reaches back three days, so a final score can only be collected in the days after the game. A model's forecast has to be on record before its game as well, so the forecasts of a day are written once, on the morning of that day, and never changed afterwards.

The package uses the Python standard library only and needs Python 3.11 or newer. On Windows, `zoneinfo` additionally needs the `tzdata` package from PyPI.

## What one run does

1. It reads the clock and works out which [slot](#schedule) it is in.
2. It reads the state file of the last run from the data directory and checks it. Two things can be due. The snapshot is due when the slot is not recorded in the state. The [daily work](#results-and-grading) is due in the [first slot of the day](#the-daily-slot), when the state does not name that slot as the one it was last done for. Either may be asked for only by a run that starts less than [75 minutes](#the-75-minutes) after the slot's start. If nothing is due, or it is too late for what is, the run says so and stops. No request is made.
3. If the daily work is due, it sends one request: `GET https://api.the-odds-api.com/v4/sports/{sport}/scores` with `daysFrom=3`, which lists the games of the last three days and says which of them are completed. For every completed game that is not yet recorded it writes a [result line](#prefixresultsyyyy-mmndjson) with the final score and the verdict on the game's last line from before the start. It rebuilds the [record](#prefixrecordjson) from all result lines. For a sport that is [forecast](#the-models), the result line also carries what each model said on the morning of the game, with a verdict on it, and the run then replays both models through every result of the season, builds the [model file](#prefixmodeljson) and, if the day does not have them yet, the [forecasts for the games of the day](#prefixpredictionsyyyy-mm-ddjson). It [checks](#checks-before-anything-is-written) what it built and writes it, together with the state, which now names the slot. This part makes no request of its own.
4. If the snapshot is due, it sends one request: `GET https://api.the-odds-api.com/v4/sports/{sport}/odds` with `regions=us`, `markets=h2h`, `oddsFormat=decimal` and `commenceTimeFrom` set to the current time, so that games in play are left out.
5. For every game that has not started it computes the [consensus](#the-consensus) of the sportsbooks.
6. It builds the board, the state and the day's history lines, [checks them](#checks-before-anything-is-written), writes them to a temporary directory and moves them into place. The board shows the record and the recent results that the daily work noted in the state, and for a sport that is forecast the models' forecasts.
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
| `record.py` | What the results add up to, for the sportsbooks' line and for each model: wins and losses, accuracy with its interval, Brier score and log loss, the bands, the days and the biggest upsets, and each model next to the sportsbooks. A pure function. |
| `snapshot.py` | Builds the board, the state and the history lines from a response and the previous state. A pure function. |
| `results.py` | Builds the result lines, the record and the state from a scores response, the previous state, the lines already recorded and the forecasts that were frozen. A pure function. |
| `model/` | The two models and the files a season starts them from, with a [README](model/README.md) of their own. |
| `forecasts.py` | Checks the results of the season, replays both models through them and builds the model file and the forecasts of the day. A pure function. |
| `validate.py` | The checks on the files of the snapshot and of the results. |
| `validate_forecasts.py` | The checks on the model file and the predictions files. |
| `checks.py` | The small checks that both of those are made of: what a time, a probability, a score and a line have to be. |
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

A game is graded against the latest line that the state file holds for it, `games.{id}.latest`. The snapshot replaces that line only before the game starts, so it is the game's last line from before the start. It is not the closing line. It is the line of the last slot before the game. When no slot was missed, that slot started at most three hours before a game that starts between 09:10 in the morning and 00:10 at night in New York.

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

For a sport that is [forecast](#the-models), the record gives each model the same figures, from the model's own forecasts and the verdicts on them: wins and losses, the accuracy with its interval, the toss-ups and the games not graded, the Brier score and the log loss, the bands by the probability of the side it picked, and its biggest upsets. For a model, `with_line` is the number of games that have a forecast which counts. Next to them it gives how the model did against the sportsbooks:

- **Late forecasts.** `late` is the number of games whose forecast was published too late to count. They are among the games not graded.
- **Different picks.** `picks_against_market` counts the games in which the model and the sportsbooks each had a favorite and the two were not the same side, and says in how many of them the model's favorite won and in how many the sportsbooks' did. One of the two was right in each. The ten latest of those games are listed.
- **The difference in Brier score.** `brier_against_market` is the model's Brier score minus the sportsbooks' over the games that both have a probability for, taken game by game: the mean of `(p_model - outcome)² - (p_line - outcome)²`. Below zero, the model's probabilities were the better ones. From 30 games on it comes with a 95% interval from a bootstrap. 10,000 times, as many games as there are are drawn from them with replacement and the mean of the draw is taken, and the interval runs from the 251st to the 9,750th of those means in order. The draws come from Python's `random.Random(20261020)`: a game is picked as `int(random() * n)` from the games in order of start. The seed is fixed, so the same result lines always give the same interval. Below 30 games there is none: resamples of so few games repeat the same ones, and the interval would be narrower than what the games can say.

The two numbers that are compared are not forecasts of the same moment. A model's is from the morning of the game. The sportsbooks' line is the one of the last slot before the start, which is hours newer and knows what the day has brought.

## The models

Two models forecast each game of the regular season: Elo ratings, and a model that rates every team in points and adds terms for home court and rest. [`model/README.md`](model/README.md) describes the two methods, where their numbers come from, how they were chosen and what they cannot know. This section says what the job does with them.

Only a sport that `config.py` gives a season is forecast, which is the regular season under `v1`. The [preseason rehearsal](#configuration) is never forecast: its games are not games of the season.

### The replay

In the daily work, when the results of the night are recorded, both models are replayed from the opening files of the season through every result of the season that is on record. It is the whole season every day, and nothing of yesterday's ratings is carried over. A morning that was missed therefore needs no repair: the next run replays the same results and arrives at the ratings it would have had by running every day.

A result is one of the season when its game's [day](model/README.md#the-day-of-a-game) is the season's first day, 20 October 2026, or a later one. A game of an earlier day is recorded and graded against its line like any other, and the models take no notice of it. The results are replayed in order of start, and within a day every game is held against the ratings as they stood that morning.

### The checks on the results

A model that counts rest is wrong about a team whose game of last night is missing from the results, and a game that is in them twice moves two ratings twice. So before the replay is trusted, three things are checked:

- No game is recorded twice.
- No team has two results on one day.
- Every game that the state knows and that started between 6 hours and 3 days before the daily run has a result. Six hours, because a game that started later may not be over. Three days, because that is as far back as the scores reach: a result that is still missing after that is not going to come, and the models go on without it.

If a check fails, the points-and-rest model is left out that day, of the model file and of the day's forecasts. Elo is published alone. `status` in both files is `degraded` in place of `ok`, and `reasons` gives one sentence for each thing that was found, such as `no result for GSW at LAL, which started at 2026-10-21T02:00:00Z (game 7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e)`. The log and the job summary say it as well. Elo is published all the same because a missing game leaves two of its ratings a little behind and does nothing else to it.

### The forecasts of the day

The daily run of a morning forecasts the games of that day: the [day](model/README.md#the-day-of-a-game) whose date is the New York date of the 05:10 slot. It makes a forecast for each of those games that the state knows and that has not started, from the results of the days before.

The forecasts go to `predictions/YYYY-MM-DD.json`, and that file is written once. A run that finds the file of the day already there leaves it exactly as it is, whatever is in it, and makes no forecast. That is what makes a forecast one that was made before its game: the file can only have been written before any game in it started, and nothing changes it afterwards. A game that the job did not know of that morning, or that had already started, has no forecast. A day without a game to forecast has no file.

The morning of the game is also the earliest moment at which the points-and-rest model can be asked. It counts rest from the results it has replayed, so it knows who played yesterday only when yesterday's results are in. A forecast made a day earlier would be made with the wrong rest for a good part of the games. This is why a game of a later day carries no forecast of that model yet.

### How a forecast is graded

When a game is over, its result line takes what each model said from the predictions file of the game's own day, and a verdict on each by [the rule of the sportsbooks' line](#the-verdict): a model favors the side it puts at 52% or more, and between 48% and 52% it has no favorite.

- A forecast counts only if it was published before the start that the scores give. One that was not stays in the line, with the time it was published at, and its verdict is `not_graded`. The record counts such a game as `late`.
- A game without a forecast is `not_graded` for the models. That is a game of a morning on which the daily work was not done, a game the job did not know of yet, and for the points-and-rest model a game of a day on which it was left out.
- Forecasts that the file holds under the game's id for other teams, or for the same two teams the other way round, are refused, as a line for other teams is.
- A game that was put off and played on another day is held against the forecast of the morning it was played on. The forecast of the first date stays in its file and is not used.

### When the models cannot be built

The results come first. If the models cannot be built, or what was built does not pass its [checks](#checks-before-anything-is-written), the results of the night are recorded all the same, graded against the sportsbooks' line and against the forecasts that were frozen on the morning of each game, and the snapshot is taken. The run then fails: [Exit status](#exit-status) says how. The model file stays as it was, no forecasts are frozen for the day, and the day's games will not be graded for the models. The run of the next morning replays everything again.

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

The [models](#the-models) cost nothing. They are worked out from the result lines and the state that the daily run has anyway, and no request is made for them.

Every response reports the credits left, and the job writes them to `state.json`, prints them and puts them in the job summary.

### What a failure costs

A run that fails before a request costs nothing for it, which is why the opening files of the models, the state file, the key, the day's history file, the results files and the predictions files are checked first. From the request on, two rules bound the cost:

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

A fault in the models costs no request. The results of that morning are [recorded without them](#when-the-models-cannot-be-built), so the daily work is on record and no later trigger asks for the scores again.

What the worst case means for the month. The plan for the regular season leaves 252 of the 500 credits of a 31-day month unused. A day on which every slot and the daily work are asked for three times costs 16 more than planned, so there is room for 15 such days. A failure of everything that lasted the whole month would come to 744 credits and would use the 500 up after 20 days.

Two things are not in these numbers:

- They count every request as charged. Whether the provider charges for a request that it refuses or does not answer is not known, so the credits spent can be fewer.
- They count three runs for a slot, which is what the schedule starts in 75 minutes. Any run that starts in that time asks. A run started by hand is one more. So is the last trigger before the slot, if GitHub starts it more than 30 minutes late and then starts the next three nearly on time.

## The files

Each sport is written under its own prefix. `basketball_nba` is under `v1`.

| File | What it is | How it changes |
| --- | --- | --- |
| [`slate.json`](#prefixslatejson) | The board: the upcoming games with the forecasts for them, the record so far and the recent results. | Replaced by every snapshot. |
| [`state.json`](#prefixstatejson) | What the job remembers between runs. | Replaced by every snapshot and by the daily work. |
| [`history/YYYY-MM-DD.ndjson`](#prefixhistoryyyyy-mm-ddndjson) | One line per game per snapshot. | Only grows. |
| [`results/YYYY-MM.ndjson`](#prefixresultsyyyy-mmndjson) | One line per game that is over. | Only grows. |
| [`record.json`](#prefixrecordjson) | What the results add up to. | Rebuilt from all result lines by the daily work. |
| [`predictions/YYYY-MM-DD.json`](#prefixpredictionsyyyy-mm-ddjson) | The forecasts of the two models for the games of one day. Only for a sport that is [forecast](#the-models). | Written once by the daily work of that day, and never changed. |
| [`model.json`](#prefixmodeljson) | Where the two models stand. Only for a sport that is forecast. | Rebuilt from all result lines of the season by the daily work. |

Common to all of them:

- A time is in UTC, to the second: `2026-10-20T22:10:41Z`. The exceptions are `slot`, `next_due` and `last_slot`, which are slot ids, and `since` and the `day` of the record, which are New York calendar dates.
- A game's day, where the models are concerned, is its tip-off time minus ten hours, as a UTC date: `results_through`, `predictions_day` and the `day` of a predictions file. For every game that starts between six in the morning and midnight in New York it is the New York calendar date.
- A probability is the home team's chance of winning unless its name says otherwise, rounded to four decimals. It is always strictly between 0 and 1: a value that would round to 0 or 1 is written as 0.0001 or 0.9999.
- A number of points is rounded to two decimals.
- A team is its three-letter code, such as `BOS`. The table is in `teams.py`.
- The JSON files are written with sorted keys, a two-space indent and a final newline.

`schema` is 1 in the JSON files, and it stays 1 when a field is added. A later version of the job may add fields to any of the files, and to new lines of the results files. A reader must ignore the fields it does not know. The formats of the history files and of the results files are final in what they hold now, because those files only grow: a line that is written is never changed. A predictions file is final as a whole.

The examples below come from one invented week: a game in New York on Tuesday 20 October, three on Wednesday, and one on Thursday that no sportsbook quotes yet.

### `{prefix}/slate.json`

The board: the upcoming games as of the latest snapshot, with the record so far and the results of the last days. Replaced by every snapshot. This one is of Wednesday at 21:10 in New York.

```json
{
  "games": [
    {
      "away": "GSW",
      "commence_time": "2026-10-22T02:00:00Z",
      "elo": {
        "p_home": 0.7117
      },
      "home": "LAL",
      "id": "7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e",
      "line": {
        "books": [
          "Book A",
          "Book B",
          "Book C"
        ],
        "captured_at": "2026-10-22T01:10:35Z",
        "hi": 0.4359,
        "lo": 0.4177,
        "n": 3,
        "p_home": 0.4275
      },
      "open": {
        "at": "2026-10-20T22:10:41Z",
        "p_home": 0.4359
      },
      "points_rest": {
        "home_court": 1.16,
        "margin": 5.14,
        "p_home": 0.6675,
        "rating_edge": 3.98,
        "rest_edge": 0.0
      }
    },
    {
      "away": "CHI",
      "commence_time": "2026-10-22T23:30:00Z",
      "elo": {
        "p_home": 0.7325
      },
      "home": "MIA",
      "id": "9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d",
      "line": null,
      "open": null,
      "points_rest": null
    }
  ],
  "generated_at": "2026-10-22T01:10:35Z",
  "models": {
    "predictions_day": "2026-10-21",
    "results_through": "2026-10-20",
    "status": "ok"
  },
  "next_due": "2026-10-22T05:10-04:00",
  "recent_results": [
    {
      "away": "BOS",
      "away_pts": 104,
      "commence_time": "2026-10-20T23:10:38Z",
      "elo": {
        "p_home": 0.707,
        "published_at": "2026-10-20T09:10:07Z"
      },
      "elo_verdict": "favorite_won",
      "home": "NYK",
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
      "points_rest": {
        "margin": 4.03,
        "p_home": 0.6329,
        "published_at": "2026-10-20T09:10:07Z"
      },
      "points_rest_verdict": "favorite_won",
      "recorded_at": "2026-10-21T09:10:07Z"
    }
  ],
  "record": {
    "elo": {
      "losses": 0,
      "wins": 1
    },
    "market": {
      "losses": 0,
      "wins": 1
    },
    "points_rest": {
      "losses": 0,
      "wins": 1
    }
  },
  "schema": 1,
  "slot": "2026-10-21T21:10-04:00",
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
| `games[].elo` | Elo's chance for the home team, as `p_home`. For a game of the day whose forecasts are frozen it is the frozen one. For any other game it is what the ratings of the last daily run make of the game now, and it can still move before the game's own morning. `null` until the models have been built once. Not there at all in a sport that is not forecast. |
| `games[].points_rest` | The frozen forecast of the points-and-rest model, as in the [predictions file](#prefixpredictionsyyyy-mm-ddjson): `p_home`, `margin`, `rating_edge`, `home_court` and `rest_edge`. `null` for a game of a later day, for a game without a forecast and on a day on which the model was [left out](#the-checks-on-the-results). Not there in a sport that is not forecast. |
| `models` | What the board's forecasts rest on: `results_through`, the day of the last result that the models have replayed, `status`, which is `ok` or `degraded`, and `predictions_day`, the day whose frozen forecasts the board carries, each `null` when there is none. The whole is `null` until the models have been built once. Not there in a sport that is not forecast. |
| `record` | The record so far: under `market`, the `wins` and the `losses` of the sportsbooks' favorite, as in [`record.json`](#prefixrecordjson), and in a sport that is forecast the same under `elo` and `points_rest` for each model's favorite. `null` until the daily work has been recorded once. |
| `recent_results` | The [result lines](#prefixresultsyyyy-mmndjson) of the games that started less than eight days before `generated_at`, sorted by start time and then by id. Each is the object that is in the results file. Empty until a result has been recorded. |

`record`, `recent_results`, `models` and the forecasts are what the daily work last noted in the state. The snapshot copies them and drops the results that have grown older than eight days. It reads no results file and no predictions file, so it can be taken whatever state those files are in. Normally the daily work and the 05:10 snapshot are done by the same run, and the board has the night's results and the day's forecasts at once. When the scores fail at 05:10 and arrive at a later trigger, the board gets them with the next snapshot, which is the one of 09:10.

### `{prefix}/state.json`

What the job remembers between runs. In this example `games` is cut to three of the four games, `models.elo` to three of the 30 teams and `models.predictions.games` to one of the two games.

```json
{
  "credits": {
    "last": 1,
    "remaining": 435,
    "used": 65
  },
  "games": {
    "5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10": {
      "away": "BOS",
      "commence_time": "2026-10-20T23:00:00Z",
      "first": {
        "at": "2026-10-19T13:10:22Z",
        "p_home": 0.6143
      },
      "home": "NYK",
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
        "at": "2026-10-22T01:10:35Z",
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
  "last_run_at": "2026-10-22T01:10:35Z",
  "last_slot": "2026-10-21T21:10-04:00",
  "models": {
    "built_at": "2026-10-21T09:10:07Z",
    "elo": {
      "ATL": 1531,
      "BKN": 1324,
      "BOS": 1602
    },
    "predictions": {
      "code_commit": "4f2a9c1e7b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a",
      "day": "2026-10-21",
      "games": [
        {
          "away": "GSW",
          "commence_time": "2026-10-22T02:00:00Z",
          "elo": {
            "away_rating": 1451,
            "home_court": 40,
            "home_rating": 1568,
            "p_home": 0.7117
          },
          "home": "LAL",
          "id": "7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e",
          "market": {
            "at": "2026-10-20T22:10:41Z",
            "hi": 0.4359,
            "lo": 0.4359,
            "n": 1,
            "p_home": 0.4359
          },
          "neutral": false,
          "points_rest": {
            "home_court": 1.16,
            "margin": 5.14,
            "p_home": 0.6675,
            "rating_edge": 3.98,
            "rest_edge": 0.0
          }
        }
      ],
      "parameters": {
        "elo": "6b406fa7bf2c09456b3cdb348baa1370b1a6b094dc8c1e1a98471d4e36333b59",
        "points_rest": "35aa82ba31018cb334985b17912f3bac189f153f501bf773e254a3164c84d146"
      },
      "published_at": "2026-10-21T09:10:07Z",
      "reasons": [],
      "results_through": "2026-10-20",
      "schema": 1,
      "sport": "basketball_nba",
      "status": "ok"
    },
    "results_through": "2026-10-20",
    "status": "ok"
  },
  "results": {
    "last_run_at": "2026-10-21T09:10:07Z",
    "last_slot": "2026-10-21T05:10-04:00",
    "recent": [
      {
        "away": "BOS",
        "away_pts": 104,
        "commence_time": "2026-10-20T23:10:38Z",
        "elo": {
          "p_home": 0.707,
          "published_at": "2026-10-20T09:10:07Z"
        },
        "elo_verdict": "favorite_won",
        "home": "NYK",
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
        "points_rest": {
          "margin": 4.03,
          "p_home": 0.6329,
          "published_at": "2026-10-20T09:10:07Z"
        },
        "points_rest_verdict": "favorite_won",
        "recorded_at": "2026-10-21T09:10:07Z"
      }
    ],
    "record": {
      "elo": {
        "losses": 0,
        "wins": 1
      },
      "market": {
        "losses": 0,
        "wins": 1
      },
      "points_rest": {
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
| `models` | What the daily work notes of the models, in a sport that is forecast. `null` until they have been built once, and not there in a state from before the models were added or of a sport that is not forecast. |
| `models.built_at` | When the scores response was received from which they were last built. |
| `models.results_through`, `models.status` | As in the [model file](#prefixmodeljson). |
| `models.elo` | Every team's Elo rating as a whole number. The board works out Elo's chance for a game of a later day from these. |
| `models.predictions` | The [predictions file](#prefixpredictionsyyyy-mm-ddjson) of the day, as it is on disk. `null` when the day has none. |

The rules the state follows:

- The first line seen for a game is kept as `first` and never replaced.
- `latest` is replaced only by a snapshot taken before the game starts, and only when the game has a line in that snapshot. Once a game has started, `latest` is its last line from before the start, which is what the game is graded against.
- A game stays until 14 days after its start and is then removed.
- A game that is missing from a response stays as it is.
- `results` and `models` are written by the daily work, from the results files and the predictions file and not from what was in the state before, and carried from one snapshot to the next. A result leaves `recent` eight days after the start of its game.

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

One file per month, named after the UTC month in which the games in it started. The daily work adds one line for every game that is over and not yet in a file. The first line below is from the daily run of 21 October, and the other two are among those of the run of 22 October: a game in which the favorite of the sportsbooks and of both models lost, and a game the job had neither a line nor a forecast for.

```
{"id":"5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10","commence_time":"2026-10-20T23:10:38Z","home":"NYK","away":"BOS","home_pts":112,"away_pts":104,"recorded_at":"2026-10-21T09:10:07Z","market":{"p_home":0.6429,"lo":0.6265,"hi":0.6542,"n":3,"at":"2026-10-20T22:10:41Z"},"market_verdict":"favorite_won","elo":{"p_home":0.707,"published_at":"2026-10-20T09:10:07Z"},"elo_verdict":"favorite_won","points_rest":{"p_home":0.6329,"margin":4.03,"published_at":"2026-10-20T09:10:07Z"},"points_rest_verdict":"favorite_won"}
{"id":"3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c","commence_time":"2026-10-22T01:10:12Z","home":"DEN","away":"DAL","home_pts":101,"away_pts":110,"recorded_at":"2026-10-22T09:10:07Z","market":{"p_home":0.6947,"lo":0.6823,"hi":0.7066,"n":4,"at":"2026-10-21T22:10:38Z"},"market_verdict":"upset","elo":{"p_home":0.802,"published_at":"2026-10-21T09:10:07Z"},"elo_verdict":"upset","points_rest":{"p_home":0.7944,"margin":9.74,"published_at":"2026-10-21T09:10:07Z"},"points_rest_verdict":"upset"}
{"id":"1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a","commence_time":"2026-10-22T01:40:55Z","home":"UTA","away":"PHX","home_pts":120,"away_pts":110,"recorded_at":"2026-10-22T09:10:07Z","market":null,"market_verdict":"not_graded","elo":null,"elo_verdict":"not_graded","points_rest":null,"points_rest_verdict":"not_graded"}
```

| Field | Meaning |
| --- | --- |
| `id` | The provider's id for the game, the same as in the board, the state, the history and the predictions file. |
| `commence_time` | The start of the game as the scores give it, which can differ from the scheduled start that the board had. |
| `home`, `away` | Team codes. |
| `home_pts`, `away_pts` | The final score: two whole numbers that are not equal. |
| `recorded_at` | When the scores response was received from which the game was recorded. |
| `market` | The [line the game is graded against](#the-line-a-game-is-graded-against): `p_home`, `lo`, `hi`, `n` and `at`, as they were in `games.{id}.latest` of the state. `at` is before `commence_time`. `null` when the game has no such line. |
| `market_verdict` | [`favorite_won`, `upset`, `toss_up` or `not_graded`](#the-verdict). |
| `elo` | What Elo said on the morning of the game: `p_home`, from the predictions file of the game's day, and `published_at`, the time that file was published at. `null` when the file has no forecast for the game. |
| `elo_verdict` | The verdict on it, by the same rule. `not_graded` when there is no forecast, and when `published_at` is [not before `commence_time`](#how-a-forecast-is-graded). |
| `points_rest` | What the points-and-rest model said: `p_home`, `margin`, its expected margin for the home team in points, and `published_at`. `null` when the file has no forecast of this model for the game. |
| `points_rest_verdict` | The verdict on it. |

Each line is one JSON object without spaces. In a sport that is forecast it has these thirteen fields, in this order. In a sport that is not, and in a line that was written before the models were added, it has the first nine. A later version may add fields after them to the lines it writes, so a reader has to take lines with and without such fields. Lines are only added at the end, in order of start within one run. A file is never rewritten or shortened, and a game is in the files once.

### `{prefix}/record.json`

What the result lines add up to. [The record](#the-record) says how each number is worked out. This is the record after the daily run of 21 October, with the one game it recorded. `points_rest` is left out of the example: it has the fields of `elo`.

```json
{
  "baseline_home": {
    "games": 1,
    "wins": 1
  },
  "by_day": [
    {
      "day": "2026-10-20",
      "elo": {
        "losses": 0,
        "not_graded": 0,
        "toss_ups": 0,
        "wins": 1
      },
      "games": 1,
      "market": {
        "losses": 0,
        "not_graded": 0,
        "toss_ups": 0,
        "wins": 1
      },
      "points_rest": {
        "losses": 0,
        "not_graded": 0,
        "toss_ups": 0,
        "wins": 1
      }
    }
  ],
  "elo": {
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
        "games": 0,
        "mean_p_favorite": null,
        "wins": 0
      },
      {
        "band": "70-79",
        "games": 1,
        "mean_p_favorite": 0.707,
        "wins": 1
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
    "brier": 0.0858,
    "brier_against_market": {
      "difference": -0.0417,
      "games": 1,
      "interval": null
    },
    "games": 1,
    "late": 0,
    "log_loss": 0.3467,
    "losses": 0,
    "not_graded": 0,
    "picks_against_market": {
      "differ": 0,
      "latest": [],
      "market_right": 0,
      "model_right": 0
    },
    "toss_ups": 0,
    "wins": 1,
    "with_line": 1
  },
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
| `elo`, `points_rest` | How each model's forecasts did, in a sport that is forecast: every field of `market`, from the model's forecasts and the verdicts on them, and the three below. Not there in a sport that is not forecast. |
| `elo.late` | The games whose forecast was published at or after the start. They are counted in `not_graded`. |
| `elo.picks_against_market` | The games in which the model and the sportsbooks picked different winners: how many there are, as `differ`, in how many the model was right, as `model_right`, and the sportsbooks, as `market_right`, and under `latest` up to ten of those games, the latest first. |
| `elo.brier_against_market` | The model's Brier score minus the sportsbooks': the `games` that both have a probability for, the `difference` over those games, and its 95% `interval` as a lower and an upper bound. `difference` is `null` without such a game, and `interval` is `null` below 30 of them. |
| `baseline_home` | The home team every time: the `games` recorded and the `wins` of the home team among them. |
| `by_day` | One entry for each day that has a game, in order: the `day`, its `games`, and under `market` the day's `wins`, `losses`, `toss_ups` and `not_graded`, with the same under `elo` and `points_rest` in a sport that is forecast. |

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
  "p_favorite": 0.6947
}
```

An entry of `picks_against_market.latest`, from the record of 22 October. Elo had the Lakers and the sportsbooks Golden State, which won. `pick` is the model's and `market_pick` the sportsbooks', both as team codes, and `right` is `model` or `market`:

```json
{
  "away": "GSW",
  "away_pts": 120,
  "commence_time": "2026-10-22T02:00:21Z",
  "home": "LAL",
  "home_pts": 99,
  "id": "7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e",
  "market_pick": "GSW",
  "pick": "LAL",
  "right": "market"
}
```

The file is written at every daily run, also when no game was added, and then comes out as it was.

### `{prefix}/predictions/YYYY-MM-DD.json`

The forecasts of the two models for the games of one day, named after that [day](model/README.md#the-day-of-a-game). The daily work of the day writes it once, and nothing changes it afterwards. This is the file of Wednesday 21 October, with a game in Denver and one in Los Angeles.

```json
{
  "code_commit": "4f2a9c1e7b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a",
  "day": "2026-10-21",
  "games": [
    {
      "away": "DAL",
      "commence_time": "2026-10-22T01:00:00Z",
      "elo": {
        "away_rating": 1394,
        "home_court": 40,
        "home_rating": 1597,
        "p_home": 0.802
      },
      "home": "DEN",
      "id": "3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c",
      "market": {
        "at": "2026-10-20T22:10:41Z",
        "hi": 0.7019,
        "lo": 0.6808,
        "n": 4,
        "p_home": 0.6907
      },
      "neutral": false,
      "points_rest": {
        "home_court": 2.19,
        "margin": 9.74,
        "p_home": 0.7944,
        "rating_edge": 7.55,
        "rest_edge": 0.0
      }
    },
    {
      "away": "GSW",
      "commence_time": "2026-10-22T02:00:00Z",
      "elo": {
        "away_rating": 1451,
        "home_court": 40,
        "home_rating": 1568,
        "p_home": 0.7117
      },
      "home": "LAL",
      "id": "7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e",
      "market": {
        "at": "2026-10-20T22:10:41Z",
        "hi": 0.4359,
        "lo": 0.4359,
        "n": 1,
        "p_home": 0.4359
      },
      "neutral": false,
      "points_rest": {
        "home_court": 1.16,
        "margin": 5.14,
        "p_home": 0.6675,
        "rating_edge": 3.98,
        "rest_edge": 0.0
      }
    }
  ],
  "parameters": {
    "elo": "6b406fa7bf2c09456b3cdb348baa1370b1a6b094dc8c1e1a98471d4e36333b59",
    "points_rest": "35aa82ba31018cb334985b17912f3bac189f153f501bf773e254a3164c84d146"
  },
  "published_at": "2026-10-21T09:10:07Z",
  "reasons": [],
  "results_through": "2026-10-20",
  "schema": 1,
  "sport": "basketball_nba",
  "status": "ok"
}
```

| Field | Meaning |
| --- | --- |
| `schema` | 1. |
| `sport` | The sport's key in The Odds API. |
| `day` | The day whose games are forecast. |
| `published_at` | When the scores response was received from which the daily work was done. Every game in the file starts after it. |
| `results_through` | The day of the last result that the forecasts were made from. `null` before the first result of the season. |
| `status`, `reasons` | `ok` with an empty list, or `degraded` with [what was found in the results](#the-checks-on-the-results). On a degraded day the file has no forecast of the points-and-rest model. |
| `parameters` | Which model made the forecasts: under `elo` and `points_rest`, the SHA-256 of each model's opening file in `pipeline/model/`, as it was on disk. |
| `code_commit` | The commit of `main` that the job ran from. `null` when the run was not told, as on a developer's machine. |
| `games` | The games of the day that the state knew and that had not started at `published_at`, sorted by start time and then by id. |
| `games[].id`, `commence_time`, `home`, `away` | As in the state at that moment. |
| `games[].neutral` | Whether the game is on the [list of neutral floors](model/README.md#what-is-hand-kept-in-the-parameters-file). Neither model gives the home team anything there. |
| `games[].elo` | `p_home`, and the three numbers it comes from: `home_rating` and `away_rating`, whole numbers, and `home_court`, which is 40, or 0 on a neutral floor. `p_home` is `1 / (1 + 10 ^ (-(home_rating + home_court - away_rating) / 400))`, worked out from these whole numbers. |
| `games[].points_rest` | `p_home`, the expected `margin` for the home team in points, and its three parts: `rating_edge`, `home_court` and `rest_edge`. The parts are rounded to two decimals and the margin is the sum of the rounded parts, so they add up as written. `p_home` is the model's own. `null` on a degraded day. |
| `games[].market` | The sportsbooks' consensus that the job held for the game at that moment: `p_home`, `lo`, `hi`, `n` and `at`, as in `games.{id}.latest` of the state. It is the line of the last snapshot before the daily work, normally the one of 21:10 the evening before. `null` when the game had no line yet. |

In the first game above, Elo's 0.802 is `1 / (1 + 10 ^ (-(1597 + 40 - 1394) / 400))`, and the margin of 9.74 points is 7.55 + 2.19 + 0.

### `{prefix}/model.json`

Where the two models stand after the results that are on record. Rebuilt by every daily run. This is the file after the run of 22 October, with four results. The three tables are cut to three of the 30 teams.

```json
{
  "built_at": "2026-10-22T09:10:07Z",
  "code_commit": "4f2a9c1e7b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a",
  "elo": {
    "constants": {
      "home_court": 40,
      "k": 20,
      "mean": 1505,
      "reversion": 0.25
    },
    "ratings": {
      "ATL": {
        "rating": 1531,
        "week_ago": 1531
      },
      "BKN": {
        "rating": 1324,
        "week_ago": 1324
      },
      "BOS": {
        "rating": 1602,
        "week_ago": 1607
      }
    }
  },
  "games": 4,
  "parameters": {
    "elo": "6b406fa7bf2c09456b3cdb348baa1370b1a6b094dc8c1e1a98471d4e36333b59",
    "points_rest": "35aa82ba31018cb334985b17912f3bac189f153f501bf773e254a3164c84d146"
  },
  "points_rest": {
    "home_court": 1.72,
    "ratings": {
      "ATL": {
        "rating": 1.2,
        "uncertainty": 3.15
      },
      "BKN": {
        "rating": -7.31,
        "uncertainty": 3.11
      },
      "BOS": {
        "rating": 4.67,
        "uncertainty": 3.04
      }
    }
  },
  "reasons": [],
  "results_through": "2026-10-21",
  "schema": 1,
  "season": "2026-27",
  "sport": "basketball_nba",
  "status": "ok",
  "teams": {
    "ATL": {
      "losses": 0,
      "wins": 0
    },
    "BKN": {
      "losses": 0,
      "wins": 0
    },
    "BOS": {
      "losses": 1,
      "wins": 0
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `schema` | 1. |
| `sport` | The sport's key in The Odds API. |
| `season` | The season of the opening files. |
| `built_at` | When the scores response was received from which the daily work was done. |
| `results_through` | The day of the last result that was replayed. `null` before the first result of the season. |
| `games` | The results of the season that were replayed. |
| `status`, `reasons` | `ok` with an empty list, or `degraded` with [what was found in the results](#the-checks-on-the-results). |
| `parameters`, `code_commit` | As in the predictions file. |
| `elo.constants` | `k`, `home_court`, `mean` and `reversion`, as in the opening file. |
| `elo.ratings` | For each team its `rating`, as a whole number, and `week_ago`, its rating after the results of the day seven days before `results_through`. Before the season is a week old that is the opening rating. |
| `points_rest` | `null` when the status is `degraded`. |
| `points_rest.home_court` | The league's home court in points, as the results have moved it. What a home team is given in a forecast is this, a constant of -0.63, and the terms for altitude and the playoffs. |
| `points_rest.ratings` | For each team its `rating` in points, with the mean of the 30 ratings taken off, so that it is a rating against an average team, and its `uncertainty`: the standard deviation of the rating after the team's last game, in points. |
| `teams` | For each team the `wins` and the `losses` in the results of the season that are on record. That is every game the job recorded from the first day of the season on, whichever part of the season it belongs to. |

The file is written at every daily run. Whatever runs came before, the same result lines give the same ratings and the same counts. `built_at` is the time of the run. `status` can differ between two runs with the same results, because a result is missed only from six hours after the start of its game until three days after it.

### What is published and what is not

The provider's [terms](https://the-odds-api.com/terms-and-conditions.html) do not allow its data to be redistributed as a data product of its own, which includes downloadable files that are meant to be a source of raw data for others. They do allow the data to be stored and displayed, and values derived from it to be calculated and displayed.

What the files take from the provider as it came is little: the id of each game, its start and its two teams, which say what a line or a result is about, and the two final scores of a game that is over. Everything else in them is worked out by the job.

Of the odds, the files hold derived values only. There is no response and no price in them, and no list of what each sportsbook quoted: the names in `books` say which sportsbooks went into a consensus and nothing more.

When only one sportsbook quotes a game, the consensus is that one sportsbook's probability with its margin removed. The line is published all the same, with `n` set to 1, but `books` is left empty, so that no file puts a number to the name of a single sportsbook. The two prices behind the number are not published and cannot be worked out from it. With two sportsbooks, `lo` and `hi` are their two probabilities and both are named, without saying which is whose. When all the sportsbooks of a game give the same probability, so that `lo` and `hi` are written as the same number, their names would say what each of them gave. `books` is left empty then too, whatever `n` is.

Of the scores, the files hold the final score of each completed game as the provider gave it, because a result cannot be told in derived values. Nothing else of a scores response is kept: no score of a game that is being played, and no time of the provider's last update. A final score is a public fact, and it is recorded here so that the record can be checked game by game. It is still taken from the provider and published in a file that anyone can download. Whether the provider's terms are meant to cover that has not been asked, and [what has not been checked](#what-has-been-checked-and-what-has-not) says so.

Of the models, the files hold what the job works out from those final scores and the schedule: ratings, chances and expected margins. A predictions file also repeats, as `market`, the consensus of each game as the state had it that morning. Those are the five numbers of a history line, without the names of the sportsbooks.

No real odds are in this repository, and no score that came from the provider. The tests and the fake server use invented games, prices and scores. Two things in the repository do come from real games. The opening files in `model/` hold ratings and parameters that were worked out from the results of earlier seasons, and no result. `tests/fixtures/fivethirtyeight_nba_elo_2022_23.csv` holds the games of one season with their scores and Elo ratings, as FiveThirtyEight published them under CC BY 4.0. The Elo rule is held to that file, and the note beside it gives the source.

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

The models, for a sport that is forecast:

- A result line that is added has thirteen fields in order: the nine, and for each model its forecast and the verdict on it. A forecast is `null`, or it holds a probability, the time it was published at and, for the points-and-rest model, a margin. The verdict is the one that the forecast, that time and the score make. It is `not_graded` when there is no forecast and when the forecast was published at or after the start.
- A predictions file that is on disk is not written with anything but what is in it.
- A predictions file is for the day in its name. Every game in it is listed once, is a game of that day and starts after the file was published. The sportsbooks' line of a game, when there is one, was captured no later than that.
- Elo's chance in a forecast is the one that the two whole-number ratings and the home court written next to it give, to the last digit. The home court is 0 on a neutral floor.
- The expected margin of the points-and-rest model is the sum of its three parts as they are written.
- `status` is `ok` or `degraded`. `degraded` comes with its reasons and without the points-and-rest model, and `ok` with no reason and with that model for every game. `parameters` gives a SHA-256 for the file of each model, and `code_commit` is a commit id or `null`.
- The counts of the model file equal a recount of the result lines of the season: the games, the day of the last of them, and every team's wins and losses.
- The Elo ratings of the model file are whole numbers for the 30 teams, and its constants are those of the opening file. A game moves two ratings by the same amount in opposite directions, so the ratings add up to what the opening ratings add up to, give or take 15 points for the rounding of 30 numbers. A team that has not played is at its opening rating.
- The points-and-rest ratings of the model file add up to zero, give or take the rounding, and every uncertainty is above zero.
- The record's figures for each model equal the recount that the sportsbooks' figures are held to, made from the model's verdicts. So do the late forecasts, the games in which the model and the sportsbooks picked different winners with who was right in them, and the number of games behind the difference in Brier score.
- What the state notes of the models and what the board shows of them are held to the same checks: Elo's 30 whole-number ratings, the forecasts of the day, and for each game on the board a chance of Elo's or `null` and a points-and-rest forecast or `null`.

The files that a run continues from go through the same checks when they are read, before a request is spent on them. A state file that fails them, or that is not JSON, stops its sport. The day's history file stops the snapshot, and the results files stop the daily work. For the results files that means every line of every file, the old ones too, because the record is rebuilt from all of them. The predictions files stop the daily work in the same way, every one of them, because the results are graded against them. The opening files of the models are read before all of this. A run that cannot use them ends with status 1 before it reads the data directory or makes a request.

An event in a response that cannot be used is a different matter. It is left out and reported in the log, and the run goes on. That covers a team name that is not one of the 30, which happens in the preseason when an NBA team plays a club from another league, and an event without a usable id or start time. For the scores it also covers a completed event [without two scores that can be recorded](#which-games-are-recorded).

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | What was due was done, or nothing was due, or the slot was [given up](#the-75-minutes). |
| 1 | Bad arguments or settings: for example `ODDS_API_KEY` is not set, or the opening files of the models cannot be used. Also when files could not be written. |
| 2 | Validation failed. |
| 3 | The provider refused a request: HTTP 401, 429, or any other answer that is neither a success nor a 5xx. |
| 4 | The provider gave no usable answer: a network error, a timeout, a 5xx, or a response that could not be read as a list of events. |

No request is repeated within a run, whichever of these it ends with.

Each sport is taken on its own, and so is each of its two steps, the daily work and the snapshot. For a step that fails nothing is written. A step that was written stays written when another one fails, before it or after it, for the same sport or for another, and the next trigger then finds it recorded and asks for the failed one only. So when the scores cannot be had, the snapshot of the slot is still taken, and when the odds cannot be had, the results are still recorded. The run ends with the status of the first failure, its messages name each sport that failed and say what of it was not written, and it reports `changed=true` because there is something to push.

There is one way for a failed step to leave something behind. Its files are moved into place one after the other, the state file last: for a snapshot the day's history, the board and the state, and for the daily work the results files, the forecasts of the day, the model file, the record and the state. If a move fails after an earlier one has worked, the files moved before it are already the new ones, although the message says that nothing was written. The state file is still the old one, so the step is not recorded and a later run in time takes it again. A snapshot then adds its own lines after those in the history. The daily work finds the games in the results file already recorded and adds none of them twice, finds the forecasts of the day published and leaves them as they are, and rebuilds the model file and the record. If something else was written in the same run, the workflow commits the moved files with it.

A message never contains the request URL or the key. For a refusal it gives the status and the provider's error code, as in `HTTP 401 (INVALID_KEY)`. An error that nobody foresaw while the answer was fetched and read ends with status 4 as well and is named by its class only, as in `the response could not be read (RecursionError)` for a body that is nested too deep.

An error that nobody foresaw in the daily work, which would be a bug in it, does not end the run where it happens. The snapshots that are due are taken first, for that sport and for the others, because a snapshot cannot be taken later. Then the error is raised, and the run ends with a traceback and status 1.

The models are a part of the daily work that can fail without the rest of it. When they cannot be built, the results of the night are written without them, with the record and the state, and the snapshot is taken. If validation refused what was built, the run prints `Validation failed for the models of ...` with what was found, then `The models for ... were not built.`, and ends with status 2. If it was an error that nobody foresaw, the run ends with the traceback, as above. Either way it names the sport in `failed` and reports `changed=true`. [When the models cannot be built](#when-the-models-cannot-be-built) says what that leaves in the files.

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

The key is read from the environment variable `ODDS_API_KEY`. `PIPELINE_COMMIT` may name the commit of the code that runs, as 40 or 64 hexadecimal digits. The model file and the forecasts of the day then give it as `code_commit`. The workflow sets it. Without it, or with anything else in it, `code_commit` is `null`.

When `GITHUB_OUTPUT` is set, as it is in GitHub Actions, the command also appends these to the file it names:

| Output | Meaning |
| --- | --- |
| `changed` | `true` when something was written, otherwise `false`. Always there. |
| `slot` | The id of the slot. Always there. |
| `results`, `results_not_graded`, `results_dropped` | The counts of the daily work, as totals over the sports it was done for in this run: the results recorded, how many of them have no line, and the completed events that were left out. Left out when it was done for none. |
| `models`, `forecasts` | What became of the models in the daily work of this run: `ok` when both were built, `degraded` when the results did not pass [the checks](#the-checks-on-the-results) and Elo was built alone, and the number of games that got a forecast in this run, which is 0 when the forecasts of the day were published already. Left out when the daily work was done for no sport that is forecast, and when the models [could not be built](#when-the-models-cannot-be-built). |
| `games`, `with_line`, `dropped` | The counts of the snapshot, as totals over the sports it was taken for in this run. Left out when it was taken for none. |
| `credits_remaining`, `credits_used`, `credits_spent` | From the quota headers: the first two from the last response, the third added up over the steps that were done. Left out when none was. |
| `written` | The counts for each prefix that was written, in the order they were written, as in `v1 9 results and 12 games, v1-dryrun 3 games`. Left out when nothing was written. |
| `failed` | The sports of which a step failed or the models could not be built. Left out when there is none. |
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

The first forced run does the daily work as well, because none is on record. The fake server lists two games of the regular season and one of the preseason as over, and a second preseason game against a team that is not one of the 30, which is dropped. The three are written to `results/` and counted in `record.json`. They come out as `not_graded`, because the server has them over from the start and no line was ever stored for them, and no forecast either.

For the regular season that run also builds the models and writes `model.json`. What is in it depends on the day the commands are run on. Before 20 October 2026 the two games are not games of the season: the log says `Elo and points-and-rest from 0 results, no game to forecast for 2026-10-10.`, with the day's date, and every team is at its opening rating. On a day of the season the two results move the ratings of the four teams that played. No game is forecast either way, because this first daily run comes before the first snapshot and knows no game yet. `python -m pytest tests/test_pipeline_daily.py tests/test_pipeline_forecasting.py` runs the command through evenings and the mornings after them, with lines and forecasts that are graded.

The second forced run asks for odds only, because the daily work is on record by then. The fake server moves its prices a little with each request, so after that run the history file has two lines per game, `latest` has changed and `first` has not.

`ODDS_API_BASE_URL` exists for this purpose only. It is accepted when it names a server on the local machine (`127.0.0.1`, `localhost` or `::1`) and refused otherwise, so that a stray setting cannot send a real key somewhere else.

## Configuration

`config.py` lists two sports:

| Sport key | Prefix | Captured | Forecast |
| --- | --- | --- | --- |
| `basketball_nba` | `v1` | Always. | From the opening files of season `2026_27`. |
| `basketball_nba_preseason` | `v1-dryrun` | Until 17 October 2026, New York date, that day included. | No. |

The preseason entry is a rehearsal. The regular season starts on 20 October 2026, and the scores request and the grading have to be tried on real games before then. The entry gets the same daily work as the regular season. It is written under its own prefix so that it stays apart from the record, and the entry is to be deleted after opening night.

A sport is forecast when its entry names a season. The two models are then started from the two files of that season in [`model/`](model/README.md), `elo_2026_27.json` and `points_rest_2026_27.json`. The preseason entry names none, so the rehearsal gets the results and the grading and no forecasts. A sport that is run with `--sport` and `--prefix` is not forecast either. Before the first game of 2027-28 the entry has to name the files of that season, which [have to be made](model/README.md#what-cannot-be-seen-from-results) first.

## The workflow

`.github/workflows/pipeline.yml`, named `Odds snapshot`, runs on the schedule above and by hand (`workflow_dispatch`, with the inputs `force` and `dry_run`). The inputs are the command's `--force` and `--dry-run`. A dry run in a slot that is already recorded, or that started 75 minutes ago or more, makes no request unless `force` is set as well.

- **One run at a time.** The runs share a concurrency group, and a run in progress is not cancelled.
- **Permissions.** The workflow's token can only read the repository. The one job is given `contents: write`, because it pushes to the `data` branch. The two actions it uses are the ones the CI workflow uses, pinned to the same commits.
- **The API key** is the repository secret `ODDS_API_KEY`. It is in the environment of the step that runs the pipeline and of no other step. The pipeline never prints it, and the workflow does not turn on shell tracing.
- **The data branch** is checked out into a second working tree, `data-branch/`, with plain git commands. Fetching needs no credentials. For the push, git is given a credential helper that reads the workflow's token from the environment, so the token is not written to disk.
- **The first run.** If there is no `data` branch yet, the job starts one that shares no history with `main`. Its first commit holds the two files in `.github/data-branch/`: a README for the branch, and `nba-predictions-app/vercel.json` with `{"git": {"deploymentEnabled": false}}`. Vercel builds the `nba-predictions-app` folder of every branch that is pushed to this repository, and that [setting](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled) tells it not to deploy this one. The job does not bring the two files up to date afterwards. When the README for the branch changes on `main`, as it did when the daily work was added and again when the models were, it has to be copied to the `data` branch by hand.
- **The code that runs** is the commit of `main` that the job checked out. The step that runs the pipeline passes its id on in `PIPELINE_COMMIT`, taken from `git rev-parse HEAD` in the checkout, so that the model file and the forecasts name the code that made them.
- **The commit.** When the pipeline reports `changed=true` and the run is not a dry run, the job commits everything in the data tree as `github-actions[bot]` and pushes to `data`. The message gives the count for each prefix that was written, as in `Snapshot 2026-10-20T18:10-04:00: v1 12 games, v1-dryrun 3 games`. A run that did the daily work puts the results it added first, as in `Snapshot 2026-10-21T05:10-04:00: v1 9 results and 12 games`, also when it added none. A run that recorded results and took no snapshot, because the scores had failed at the trigger before it, is committed under the same first word: `Snapshot 2026-10-21T05:10-04:00: v1 9 results`. The job never pushes to `main` and never forces. The push is made with the workflow's own token, and GitHub [does not start workflow runs](https://docs.github.com/en/actions/concepts/security/github_token) for events caused by that token, so CI does not run on these commits.
- **One step failed, another was written.** The pipeline step then ends with a failure and reports `changed=true`. The commit step has `!cancelled()` in its condition, so it runs all the same and pushes what was written. The job still ends as failed, because one of its steps failed, and that is what tells the owner.
- **A push that is refused.** If the branch has moved in the meantime, or the remote turns the push away for another reason, the run fails and nothing of it is recorded. The next run asks again, if it starts within the slot's 75 minutes.
- **The summary** of each run says what was recorded: the results, when the daily work was done, and the games of the snapshot, when one was taken. After the results it says what became of the models: that both were rebuilt, or that Elo was built alone because the results did not pass the checks, and how many games were forecast in the run. It gives the credits that are left, names the sports that failed, and says when a slot or its daily work was given up.

## Tests

```bash
python -m pytest tests/test_pipeline_*.py
```

They need pytest and nothing else, make no request to The Odds API, and use a dummy key and invented games, prices and scores. The one file of real games is the season of FiveThirtyEight's ratings that the Elo rule is held to. The tests of the two models themselves, `test_pipeline_season.py`, `test_pipeline_elo.py` and `test_pipeline_points_rest.py`, are listed in [`model/README.md`](model/README.md#tests).

| File | What it covers |
| --- | --- |
| `tests/test_pipeline_teams.py` | The team table against the web app's logo table, the scoreboard fixture and `nba_api`'s list of teams. The last check is skipped when `nba_api` is not installed. |
| `tests/test_pipeline_consensus.py` | The margin-free share, the median, the range and the count, and every way a sportsbook's quote can be unusable. |
| `tests/test_pipeline_grading.py` | The favorite from 52% on, the toss-up between 48% and 52%, and the four verdicts. |
| `tests/test_pipeline_record.py` | The record's arithmetic against figures worked out by hand: the Wilson interval of 41 wins in 60 games, a Brier score and a log loss of four games, which band a favorite falls in, the New York day of a game, the three biggest upsets, and that the same lines give the same bytes in any order. For a model: the same figures from its own forecasts, a forecast that came too late, the games in which it and the sportsbooks picked different winners, the difference in Brier score game by game, and its interval, which is not there before 30 games, comes from 10,000 resamples with the fixed seed and is about two standard errors either side. |
| `tests/test_pipeline_results.py` | What a scores response becomes: a stored home share of 0.532 and a 112 to 104 home win is a favorite that won, 0.505 is a toss-up, no stored line is not graded, a line captured at or after the start is refused, only a completed game with two scores that differ is recorded and only once, two missed daily runs are caught up from one response, and what the run notes in the state. For a sport that is forecast: what each model said that morning and the verdict on it, a forecast published at the start or after it, which stays in the line and is not graded, one published a second before it, which is, the start that counts, which is the one the scores give, forecasts for other teams, and a game that was put off, which is held against the forecasts of the day it was played on. |
| `tests/test_pipeline_schedule.py` | The slot table on 31 October, 1 November and 2 November 2026, across the end of daylight saving time, the cron triggers walked over those three days, the 75 minutes: which triggers of a slot start in time, and which slot is the daily one at each moment of those days. |
| `tests/test_pipeline_timestamps.py` | The timestamp format. |
| `tests/test_pipeline_snapshot.py` | The three outputs for a response, that a single sportsbook is not named and neither are several that all give the same probability, and the state rules: the opening line is kept, a started game's line is never replaced, a game leaves after 14 days, an unusable event is dropped and reported, and what a daily run noted is carried over and shown on the board for eight days. For a sport that is forecast: a game of the day carries the frozen forecasts of both models and not what the ratings would make of it now, a game of a later day carries Elo's chance alone, a game that was put off loses its frozen forecast, and a neutral floor has no home court. |
| `tests/test_pipeline_validate.py` | Each check, by breaking one thing in a valid snapshot, in a valid result, in a results file or in the record that was built from the results, for the sportsbooks' line and for the fields and the figures of the models. |
| `tests/test_pipeline_forecasts.py` | What the daily work builds of the models, against numbers worked out by hand: both at their opening state before the first result, the forecast of each game of the day, Elo's chance from its whole-number ratings, the three parts that add up to the margin, the neutral floor, the ratings moved for exactly the teams that played, the rating of a week ago, the forecasts of a day made from the results of earlier days only, the same bytes from the same lines in any order, the same ratings after a day that was skipped, each of the three checks on the results with the six hours and the three days at their edges, Elo alone when one fails, and forecasts that are published and not made again. |
| `tests/test_pipeline_validate_forecasts.py` | Each check on the model file, on a predictions file, on what the state notes of the models and on what the board shows, by breaking one thing in what the builder produced. |
| `tests/test_pipeline_store.py` | The file formats on disk and the paths, those of the model file and of the forecasts of a day among them, that a result line is read back as it was written, that a write which fails before any file is moved leaves the data directory as it was, the order of the moves, and that the temporary directory of a killed run is removed. |
| `tests/test_pipeline_oddsapi.py` | The two requests against the fake server, for odds and for scores: the parameters of each, and for both of them that a request is sent once whatever comes of it, the refusals, a redirect, a body that is nested too deep, and that no error message or traceback holds the key or the URL. |
| `tests/test_pipeline_cli.py` | The snapshot from end to end: a first run, a second run in the same slot, three slots of one evening, 401, 429 and 503, a validation failure, files that cannot be written, a slot just inside and just outside its 75 minutes, `--dry-run`, `--force`, and `--all` with two sports of which one fails. After every run it looks for the dummy key in the output and in the files. |
| `tests/test_pipeline_daily.py` | The daily work from end to end, with lines taken on an evening and scores asked for the next morning: the result lines, the record, the state and the board, a second run that changes nothing, the next morning's run that only adds, two missed daily runs caught up from one response, scores that fail while the snapshot is taken and the reverse, scores that fail all morning and are asked for three times, a run that is too late, `--force`, `--dry-run`, an event that is dropped, a line that is refused, two months in two files, each check that refuses the daily work, a write that fails halfway, files from before there was any daily work, and a bug in the daily work that must not cost the snapshot. For the regular season it also expects the model file, the forecasts of each day and the fields of the models in every file. After every run it looks for the dummy key in the output and in the files. |
| `tests/test_pipeline_forecasting.py` | The models from end to end, through the mornings of an invented week: the first morning with both models at their opening ratings and a forecast for each game of the day, the second morning with yesterday's games graded for the sportsbooks and for both models and the ratings moved for exactly the teams that played, yesterday's forecasts left byte for byte as they were by every later run, a forecast that was published after the start, daily work that is done by hand late in the evening, which forecasts what is left of that day and nothing of the next, a result that is missing, with Elo published alone and the reason in the files, and the morning after, when it has arrived, a morning that was missed and leaves the same model file, the same morning run twice, the commit that the workflow passes on, `--dry-run`, the preseason rehearsal, which is never forecast, files from before the models, which are continued from, a fault in the models that must not cost the results, models that do not pass their checks, a predictions file that cannot be read, opening files that cannot be used, and each check that refuses what the models built. |
| `tests/test_pipeline_credits.py` | The bound on requests. Every cron trigger of a day is walked through the command, on an ordinary day and on the days of 25 and of 23 hours, once for each way a run can end, including the scores failing while the odds answer and the reverse. The odds requests are counted for each slot, each sport and the day, and the scores requests for each sport and the day: one when the daily work succeeds, three when it does not, all of them in the day's first slot. A day as planned is priced as the provider's guide prices it and comes to 8 credits for a sport. |
| `tests/test_pipeline_workflow.py` | The workflow file, read as text: every slot starts on a cron trigger, the 75 minutes are given as `schedule.py` has them, the actions are pinned to the commits CI uses, the token is read-only outside the job that pushes, the checkout keeps no credentials, the key goes to one step, runs wait for each other and none is cancelled, the job is limited to 10 minutes, what was written is pushed although the pipeline step failed and that step still fails the job, the commit message has the count for each prefix, every output that the workflow reads is one that the command writes, the summary has a line for the results, one for what became of the models and one for results that were given up, the pipeline is told the commit of `main` that it runs, and the only push is an unforced one to `data`. |

## What has been checked, and what has not

Checked on 10 October 2026 in a review of the daily work and the models, before they were pushed. The review had harnesses of its own, which share the fake server with the tests and nothing else:

- The files that were on the `data` branch at 22:22 UTC, written by the snapshot as it was before the daily work, were continued from by the job as it is now. Every cron trigger from that evening to 25 October was run against the fake server, with the games that those files list and invented prices and scores: 702 runs, and none failed. The history and the opening lines that were on the branch stayed as they were. The eight preseason games were graded, six of them against a line that the earlier code had stored. The first file of forecasts was the one of 20 October, with the three games that open the season, and every whole day cost 6 odds requests and 1 scores request for a sport.
- A season of 1,315 invented games was run through the command slot by slot, to the end of May, with four mornings on which no run came in time and one game that was never played. For each of the 1,285 games in the 201 files of forecasts that it froze, Elo's forecast was worked out again by a function written for the review, and the points-and-rest model's by its reference implementation, except for the 28 games of three mornings on which that model was left out. Each was the one in the file. The ratings of the model file after the last game were those of the same two replays. At four dates the record was what a recount written from this README gives, the intervals included. The longest daily run, with 1,300 games in the record, took under two seconds on a laptop.
- Every cron trigger of three days was walked through the command for fifteen ways a run can go, on 15 to 17 October with two sports, on 20 to 22 October and on 31 October to 2 November, and the days of 20 to 22 October once more with every run starting up to 29 minutes late. No sport was asked for its odds more than 3 times for a slot or for its scores more than 3 times a day, the scores were asked for in the 05:10 slot only, and nothing that was recorded was asked for again.
- The shell steps of the workflow were read out of the workflow file and run by a second harness, on a developer machine and in a Linux container with Python 3.12, against a temporary bare git repository and the fake server: the run that starts the branch, the first morning of the season, the second, a forced run, a morning on which the scores fail and the snapshot is pushed, a dry run and a push that is refused. The two logs are the same line for line, apart from commit ids, and each file of forecasts was touched by one commit.
- The opening ratings of Elo were computed once more, by a function written for the review, from FiveThirtyEight's file and the results of the backtest. The 30 whole numbers are the ones in the opening file, and the same run gave 66.7%, 0.6065 and 0.2096 on the 2,643 test games.
- The port of the points-and-rest model was run next to its reference implementation on 40 invented seasons and 2,755 forecasts, with neutral floors, back-to-backs and dates in the playoffs among them. The state and every forecast were equal to the last bit.
- Each check was called on files that the job had written, with one value at a time removed or replaced by something that a JSON file can hold and the check does not expect. Three places in the checks of the forecasts raised an error where they should have named a problem: the id of a game that is a list or an object, a number of points that is Infinity, NaN or too large, and Elo ratings too large for a chance to be worked out from. They name it now, tests hold them to it, and 50,568 such calls raise nothing. The two builders were handed 9,912 lists of events with one such value in each and fell over none.
- The code was changed in one place at a time, 90 times, and the tests were run after each change. One change went unnoticed: the day to forecast taken from the UTC date of the run, which shows only when the daily work is done by hand after 20:00 in New York. `tests/test_pipeline_forecasting.py` has a test for that hour now, and it fails under that change.
- The first day of the season with its three games, the last day of the regular season, the three games on neutral floors and the place and the date of the final of the NBA Cup are as the NBA's [key dates](https://www.nba.com/news/key-dates) for 2026-27 give them.
- The tests have still not run on x86_64, which is what GitHub's runners are. The one number in them that follows the C library to the last bit is the chance of the points-and-rest model. For its five expected values, glibc's error function was written out again in Python and worked through with fused multiply-add, as an arm64 build has it, and without, as an x86_64 build does. Both ways gave the five chances that the arm64 container gives, which the test allows.

Checked on 10 October 2026, with the models in place:

- The tests above pass on Python 3.11 in a Linux container and on Python 3.13 and 3.14 on macOS. The whole test suite, with the repository's requirements installed, passes on Python 3.12 in a Linux container, which is what CI runs.
- Each test that came with the models was seen to fail. The code was changed in one place at a time, on a scratch copy, 440 times, and after each change the tests that are meant to notice it were run. Every change made a test fail, and each of the 229 new test functions failed under at least one of them. Among the changes: a home court on a neutral floor, the winner's edge taken without the home court, a day's games settled one after the other instead of against the ratings of the morning, the cap of 22 points applied to wins alone, any earlier game counted as a back-to-back, a logistic curve in place of the normal one, a day that begins at nine or is the UTC date, Elo's ratings published with their decimals, a margin that is the model's own and not the sum of its parts, a result expected for two days or still at three, a team's two results on one day passed over, the points-and-rest model published whatever the checks say, the forecasts made from the opening state or for the day after, a file of forecasts written a second time, a forecast published at the start graded, a model's Brier score compared over every game it forecast, an interval from 31 games on or from the system's randomness, the opening files read after the first request, the preseason forecast, a fault in the models that costs the results or is passed over in silence, the model file moved into place after the state, and older lines held to the thirteen fields.
- The shell steps of the workflow were run through the first week of the season on a developer machine and in a Linux container, against a temporary bare git repository standing in for `origin`, whose `main` held the code, and against the fake server, with the clock set for each run and six invented games. The runs were: Monday evening, which starts the branch and lists the games. Tuesday morning, the first daily run of the season, with no game over: both models at their opening ratings, a forecast for each of the two games of the day, and the commit of `main` named in both files. A second trigger in that slot, and the evening's snapshot, whose board carries the forecasts of the morning. Wednesday morning: Tuesday's two games graded for the sportsbooks and for both models, the Elo ratings moved for exactly the four teams that played, to numbers worked out by hand, Tuesday's file of forecasts the same bytes as before, and Wednesday's three games forecast, with the second night in a row of one visiting team counted. A forced run that afternoon, which asks for no scores and forecasts nothing again. Thursday morning with one result missing: Elo alone, with the reason in the model file, in the forecasts, in the log and in the job summary, and a job that succeeds. Friday morning, when that result has arrived: both models again, the late game held against Wednesday's forecasts, Thursday's game not graded for the points-and-rest model, and no file for a day without a game. Then the same week on a second repository in which every morning was missed: the daily run of Friday records all six games, and its model file has the ratings of the week that was not missed. In every run the requests, the commit message, the job summary and the files on the branch were as this file describes them, and each file of forecasts was touched by one commit. The logs of the two machines are the same line for line, apart from commit ids and versions.
- A data directory that the job had written as it was before the models, with a state and a board that say nothing of a model and result lines of nine fields, was continued from by the job as it is now: a snapshot first, then a daily run that left the old lines as they were and built both models from all the results.
- The opening ratings of Elo were computed again, outside the repository, with the code and the results of the backtest. New York came to 1720.46, San Antonio to 1701.99 and Oklahoma City to 1683.79, and the 30 ratings to a sum of 45,149.56, which is 45,149 in whole numbers. An earlier, independent run had given 1720.5, 1702.0 and 1683.8, and a sum of about 45,150. The same run gave the backtest's figures for Elo on its two test seasons: 66.7%, a log loss of 0.6065 and a Brier score of 0.2096.
- The port of the points-and-rest model was held to the 58 expected numbers of its reference implementation on macOS and in Linux containers on Python 3.11, 3.12 and 3.13. [`model/README.md`](model/README.md#points-and-rest) says what came of it: on Linux one chance differs by one unit in the last place.
- The three games on the list of neutral floors were found in news reports of the NBA's schedule, and where the NBA Cup is played this season in two announcements on nba.com.
- `actionlint` 1.7.12, run from its container image, reports nothing for the workflow file.
- The three commands under [Against the fake server](#against-the-fake-server) were run as written, and the examples of the files in this README were produced by the command and its builders from invented games.

Checked on 10 October 2026 with the daily work in place, before the models were added. The first item and the last two were repeated with the models, as the list above says, and the others were not:

- The tests above pass on Python 3.11 and 3.12 in Linux containers and on Python 3.13 and 3.14 on macOS. The whole test suite, with the repository's requirements installed, passes on Python 3.12 on Linux, which is what CI runs.
- Each test that came with the daily work was seen to fail. The code was changed in one place at a time, on a scratch copy, 202 times, and after each change the tests that are meant to notice it were run. Every change made a test fail, and each of the 132 new test functions failed under at least one of them. Among the changes: the scores asked for with another number of days or on the path of the odds, a second scores request after a failure, the favorite from 51% or from 53%, the away team's probability taken from 1 in floating point, the interval at another level or without its second term, the Brier score without the square, a band that starts a point later, the day taken in UTC, each check of the results and of the record switched off, a result kept on the board for exactly eight days, a game recorded a second time, a line captured at the start accepted, the scores asked for in every slot or without the limit of 75 minutes, daily work repeated by `--force`, the state file moved into place first, and a bug in the daily work that ends the run before the snapshot.
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

- There is the log of a run that was started by hand with `force` and `dry_run` at 18:42 UTC, before the daily work was added. It shows one odds request for each of the two sports and nothing written: 46 games of the regular season and 8 of the preseason, each with a line, and none dropped.
- By 20:08 UTC there was a `data` branch, so a scheduled run of the snapshot had written and pushed by then. At 22:22 UTC it had three commits: the one that starts the branch, and the snapshots of the 15:10 and of the 18:10 slot, each with 46 games of the regular season and 8 of the preseason. Those are the files that the review above continued from.

Not checked:

- The models have not run on GitHub, and no game of the season has been played. No result of the provider has been replayed. A forecast has been made from the provider's schedule only as the files on the `data` branch held it on 10 October, in the review above.
- The backtest was not run again here, apart from the Elo run above. Its figures in `model/README.md`, the 38% of wrong back-to-back flags among them, are taken from the notes of those who ran it and of the reviewer. How the 38% was counted is not in those notes. A count for the review above, in the results of the backtest, of the games in which at least one team had played the day before, which is where a forecast made a day early gets a flag wrong, came to 28.4% of the 2,643 test games and to 33.2% of all 28,382.
- The altitudes in the parameters file were not held against another source.
- The rehearsal puts a clone in the place of the checkout action. That `git rev-parse HEAD` names the commit of `main` in the step on GitHub, as it did there, has not been seen.
- Whether the provider keeps the id of a game that is put off, and which start the scores then give for it, is not known.
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
- The models know the schedule and the final scores and nothing else. [`model/README.md`](model/README.md#what-cannot-be-seen-from-results) says what follows from that, and what in their files is kept by hand.
- A game has a forecast only if the job knew it on the morning of its day and it had not started. A morning on which the daily work is missed or given up freezes nothing, and the games of that day are not graded for the models. A forced run later that day still forecasts the games that have not started by then.
- A morning on which the models [could not be built](#when-the-models-cannot-be-built) cannot be made up for that day, by a forced run either: the daily work is on record, and it is not done twice.
- A model's forecast is made on the morning of the game, and the sportsbooks' line it is compared with is the one of the last slot before the start, which is hours newer. The record does not correct for that.
- A model's pick counts from 52% on, like the sportsbooks' favorite, and between 48% and 52% a model has no pick. The backtest in `model/README.md` counted a pick above 50%, so its shares of winners are not comparable with the record's.
- A game that the job has seen and that is then put off, or that the scores never list as completed, has no result. From six hours after its scheduled start until three days after it, [the checks](#the-checks-on-the-results) take that for a missing result, and the points-and-rest model is left out on those mornings.
- A predictions file that fails its checks stops the daily work of its sport, the results included, until the file is as it was. The files are not meant to be edited, and the history of the `data` branch has every one of them as it was written.
- That a forecast was published before its game is the job's own statement, in `published_at`. What a reader can hold it against is the history of the `data` branch: the commit that added the file, and the workflow run that pushed it, which GitHub lists with the time it started.
