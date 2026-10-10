# The two models (`pipeline/model/`)

Two models forecast every NBA game. Both use the schedule and the final scores of the season so far, and nothing else: no injuries, no line-ups, no trades, no betting odds. The [daily run](../README.md#the-models) replays both from the opening of the season every morning, freezes their forecasts for the games of the day, and afterwards grades each forecast next to the sportsbooks' line.

| File | What is in it |
| --- | --- |
| `elo.py` | Elo ratings: the chance of a game, what a result does to two ratings, a season replayed, and the step between two seasons. |
| `elo_2026_27.json` | The constants and the 30 opening ratings of 2026-27. |
| `points_rest.py` | The points-and-rest model: a rating in points for every team with its uncertainty, and six terms for home court and rest. |
| `points_rest_2026_27.json` | Its constants, the six coefficients, the opening state, the altitude of each arena and the list of games on a neutral floor. |
| `season.py` | What the two share: the day a game belongs to, the games on a neutral floor, and the loading of the two files. |

## Elo

The method is the one FiveThirtyEight used for its NBA ratings. Every team has one number. Before a game, the home team's chance of winning is

```
P(home) = 1 / (1 + 10 ^ (-(home + home court - away) / 400))
```

and after it the winner takes from the loser

```
K x multiplier x (1 - the chance the winner was given)
multiplier = (margin + 3) ^ 0.8 / (7.5 + 0.006 x the winner's edge)
```

The winner's edge is its rating minus the loser's, with the home court added for the home team. The multiplier makes a win by more points count for more, and a favorite's win count for less than an underdog's by the same margin. On a neutral floor there is no home court. Between two seasons every rating gives up a quarter of its distance to 1505.

| Constant | Value | |
| --- | --- | --- |
| K | 20 | FiveThirtyEight's. |
| Home court | 40 | FiveThirtyEight used 100. In the seasons 2023-24 to 2025-26 a home court of 40 scored better than 100, and 40 is what the backtest below was run with. |
| Mean | 1505 | FiveThirtyEight's. |
| Reversion between seasons | 25% | FiveThirtyEight's. |

A worked game. Boston, at 1607, hosts New York, at 1720, and wins 112 to 104. Boston's edge was 1607 + 40 - 1720 = -73, so its chance was 1 / (1 + 10 ^ (73 / 400)) = 0.3965. The multiplier is 11 ^ 0.8 / (7.5 - 0.006 x 73) = 0.9642, and Boston gains 20 x 0.9642 x (1 - 0.3965) = 11.64 points, which New York loses. The two changes are always equal and opposite, so a game leaves the sum of the 30 ratings as it was.

**What is published is worked out from whole numbers.** The ratings are replayed with their decimals and published as whole numbers, and the chance that is published for a game is worked out from the two whole numbers next to it. A reader who puts 1607, 1720 and 40 into the formula gets the 0.3965 that is written. The chance from the ratings with their decimals can differ from it by about 0.001.

### Where the opening ratings come from

`elo_2026_27.json` holds 30 whole numbers that add up to 45,149. They start from each team's last rating in FiveThirtyEight's published file of NBA Elo ratings, which ends with the finals of June 2023. Those ratings were carried through the 3,962 games of 2023-24, 2024-25 and 2025-26 with the rule above and a home court of 40, with the 25% step before each of the three seasons, and once more for the start of 2026-27. The three highest are New York at 1720, San Antonio at 1702 and Oklahoma City at 1684.

FiveThirtyEight published its data under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/). The ratings here are derived from that file, and `tests/fixtures/fivethirtyeight_nba_elo_2022_23.csv` is an extract of it, with a note next to it that says what was taken. `tests/test_pipeline_elo.py` holds `elo.py` to every one of the 1,320 games in the extract: with a home court of 100, the rule gives the chance and the two new ratings that FiveThirtyEight published for each game.

## Points and rest

The second model rates every team in points and knows how well it knows each rating. Everything in it is in points.

Every team has a **rating** and a **variance**. The league has one **home-court value**, and one number, the **spread**, that scales the forecast to how far recent results were from what was expected. For a game:

```
variance     = the team's variance + 0.06 x the days since its last game
rating edge  = home rating - away rating
home court   = league value + home constant
               + altitude term x the kilometres the home arena lies above the visitors',
                 and nothing when it lies lower
               + playoff term, after the regular season
               (all of it is 0 on a neutral floor)
rest edge    = home back-to-back term, if the home team played yesterday
               + away back-to-back term, if the away team played yesterday
               + seven-day term x (home games - away games in the seven days before)
margin       = rating edge + home court + rest edge
sd           = scale x sqrt(spread x (home variance + away variance + 12 ^ 2))
P(home)      = Phi(margin / sd)
```

Phi is the normal distribution function. When the games of a day are over, each of them moves the two ratings:

```
surprise      = the home margin, cut off at 22 points in either direction,
                minus (rating edge + league home court)
total         = home variance + away variance + 12 ^ 2
home rating  += home variance / total x surprise
away rating  -= away variance / total x surprise
each variance shrinks by its square / total
league home court += surprise / 3000, off a neutral floor
spread            += (surprise ^ 2 / total - the spread at the start of the day) / 1000
```

A team whose rating is less certain moves more. On opening night a rating is known to about 3.1 points either way and takes about 6% of a surprise. After 40 games it is known to about 2.2 points and takes about 3%. A forecast for a day uses the state as it was before that day's first game.

| In `points_rest_2026_27.json` | Value | Meaning |
| --- | --- | --- |
| `constants.sigma` | 12 | The noise of a single game, in points. |
| `constants.q_per_day` | 0.06 | What a variance grows by each day. |
| `constants.cap` | 22 | The margin a blowout counts as. |
| `constants.alpha`, `beta` | 1/3000, 1/1000 | How fast the league's home court and the spread follow the results. |
| `constants.rho`, `tau2` | 0.8, 7.0 | The step between seasons: a rating keeps 80% of its distance to the league's mean, and a variance becomes 0.64 times itself plus 7. |
| `coef.home` | -0.633 | Added to the league's home court. Part of what looks like home court is the visitors' worse rest, which has its own terms. |
| `coef.b2b_home` | -1.352 | The home team played yesterday. |
| `coef.b2b_away` | +1.706 | The away team played yesterday. |
| `coef.games7_diff` | -0.319 | For each game more that the home team played in the last seven days. |
| `coef.altitude_km` | +0.742 | Per kilometre. Denver's arena is at 1.609 km and Utah's at 1.288 km, which is about 1.2 and 1.0 points against a team from sea level. |
| `coef.playoff_home` | +1.812 | After the last day of the regular season. |
| `kappa` | 0.9446 | The scale of the standard deviation. |
| `state.home_court`, `state.r` | 1.725, 0.963 | The league's home court and the spread on opening day. |
| `state.teams` | | Each team's opening rating and variance. |

With these, a home team at sea level with equal rest starts 2026-27 with 1.725 - 0.633 = 1.09 points, and near an even game one point of margin is worth about 3.4 percentage points on opening night.

`points_rest.py` is a port of the reference implementation that the parameters were delivered with. That implementation came with a file of expected values for whoever ports it: seven results with invented scores, the state they lead to, and five forecasts that go through a blowout beyond the cap, both back-to-backs, a neutral floor, a game at altitude and a date in the playoffs. The file is `tests/fixtures/points_rest_golden.json`, kept as it was delivered. The state and every part of the five forecasts come out equal to the last bit. The chance goes through the C library's error function and is held to one unit in the last place: on Linux one of the five differs from the file by that much, and on macOS, where the file was written, by nothing.

### What is hand-kept in the parameters file

- **The games on a neutral floor.** The Odds API does not say where a game is played, so the list is in the file: Indiana against Denver in Mexico City on 7 November 2026, and San Antonio against New Orleans in Paris on 14 January 2027 and in Manchester on 17 January. A game is matched by its day and by the pair of teams, whichever of them the schedule calls the home team. Both models read this list. **The final of the NBA Cup is missing from the list and has to be added by hand.** It is played on a neutral floor, at Hinkle Fieldhouse in Indianapolis on 11 December 2026, and its two teams are not known until the semifinals are over. The quarterfinals and the semifinals are hosted by the higher-seeded teams this season, as the NBA [announced](https://www.nba.com/news/emirates-nba-cup-2026-groups-announced), so they stay off the list. A change to the file changes the SHA-256 that the published files give for it under `parameters`, which is how a reader can tell from which day on the list was longer.
- **The last day of the regular season,** 11 April 2027, after which the playoff term applies.
- **The altitude of each arena,** which is taken to be what it was in 2025-26.

## The day of a game

A game's day is its tip-off time minus ten hours, as a UTC date. Ten hours after midnight UTC is five or six in the morning in New York, when no game is being played, so one evening's games share a day wherever they tip off: a game at 22:30 in New York on Tuesday starts on Wednesday in UTC and is a game of Tuesday. Rest is counted in these days, the list of neutral floors is matched by them, and the forecasts of a day are the forecasts for the games of that day.

## How the two were chosen

Both models were chosen in a backtest that was run outside this repository, on the final scores of 28,382 games of the 22 seasons from 2004-05 to 2025-26. Every setting of the points-and-rest model was chosen on the seasons through 2023-24. The two seasons after that, 2024-25 and 2025-26, were scored once, with the rule for what would be shipped written down beforehand. Elo's home court of 40 is the one setting that was not chosen that way, as said [below](#what-cannot-be-seen-from-results). Each game was forecast from the games that had ended on earlier days only.

On those 2,643 games, with 95% intervals from resampling the games:

| | Winners picked | Log loss | Brier score |
| --- | --- | --- | --- |
| Elo | 66.7%, 1,762 games (64.9% to 68.4%) | 0.6065 (0.5919 to 0.6212) | 0.2096 (0.2032 to 0.2161) |
| Points and rest | 67.6%, 1,786 games (65.8% to 69.3%) | 0.6031 (0.5890 to 0.6175) | 0.2082 (0.2020 to 0.2145) |
| The home team every time, at last season's home-win rate | 55.0% | 0.6881 | 0.2475 |

A winner counts as picked here when it was given more than 50%. The record on the data branch counts a pick from 52% on, so its shares of wins are not the same kind of number as these. Lower is better for log loss and for the Brier score, and one half for every game scores 0.6931 and 0.25.

What this does and does not show:

- **It is not shown that the points-and-rest model picks more winners than Elo.** The gap of 24 games is within what chance produces: the 95% interval of the difference runs from 1 game fewer to 49 more. Expect the two to pick about the same number of winners.
- **Its percentages scored slightly better.** Game by game, its log loss was lower by 0.0034, with a 95% interval from 0.0067 to 0.0001 lower, and its Brier score by 0.0015. That is about half a percent.
- **The difference showed in one of the two test seasons.** In 2024-25 the log loss was lower by 0.0064 (0.0110 to 0.0018). In 2025-26 the two were level: 0.0003 lower, with an interval from 0.0051 lower to 0.0044 higher.
- **Where it differs from Elo is on back-to-backs.** In the 295 test games where only the home team had played the night before, home teams won 47.5%. This model had said 49.9% and Elo 55.4%. In the 314 where only the visitors had, home teams won 57.6%. This model had said 58.5% and Elo 54.0%. In the games where neither team had played the night before, the two scored the same.
- **Neither was tested against the sportsbooks.** The backtest had no odds. How the two do next to the sportsbooks' line is what the [record](../README.md#prefixrecordjson) on the data branch is for, from opening night on. No figure of the backtest is a result of 2026-27.

A second reviewer, who had not built the backtest, ran it again with code of their own and looked for any use of later results. Their notes say this: replacing every score from a given day on changed no forecast for that day or earlier, on each of the 426 game days of the two test seasons. Scored against results that had been shuffled among the games, both models fell below what picking the home team every time gets. Three deliberately leaky versions were caught by the same tests. A separate implementation that is handed one day's schedule at a time reproduced the forecasts of both models for all 2,643 games. The wording of the list above is that reviewer's correction of an earlier and more favorable one.

Of all this, one thing was run again for this repository: the Elo run that produced the opening ratings also gave 66.7%, 0.6065 and 0.2096 on the 2,643 games.

### Where the scores of the backtest came from

From ESPN's public scoreboard feed, which is not documented and publishes no terms of use. For that reason the scores are not in this repository and are not published anywhere: what is here are the parameters and the ratings that were derived from them. The scores of the 19 seasons through 2022-23 were checked against FiveThirtyEight's file, which agrees on 24,415 of 24,420 games. For the three seasons after that there was no such file to hold them against.

## What cannot be seen from results

- **Scores and schedule only.** A team that loses its best player is rated as before until its results show it. In the backtest a points-and-rest rating moved by a third of a point a game on average.
- **Early in a season the ratings lean on the season before.** The opening ratings are last season's, moved a quarter of the way to the mean for Elo and a fifth for the points-and-rest model. A summer's trades and the draft are not in them.
- **The expected margin is on a scale where a blowout counts as 22 points.** Against margins cut off at 22 it was unbiased in the test seasons. Real margins ran about a fifth larger than it says, because one game in six was decided by more than 22 points, and on a single game it was off by 11 points on average. It is a number to compare games by, not a spread to bet against.
- **A forecast is made on the morning of the game and not before.** The points-and-rest model counts rest from the results it has replayed, so a forecast made a day early does not know who plays the evening before. In the review of the backtest such forecasts had the wrong back-to-back flag in 38% of games. This is why the daily run forecasts the games of its own day only, and why nothing but Elo's chance is shown for later games.
- **The hand-kept list of neutral floors has to be kept current.** A game that is missing from it gets a home court it does not have, in both models.
- **The playoffs.** In the two test postseasons, 181 games, the points-and-rest model's log loss was worse than Elo's, 0.657 against 0.653, although it picked more winners. The playoff term gave home teams more than they showed in those two years.
- **Elo's home court of 40** was chosen by comparing home courts on the seasons 2023-24 to 2025-26, which include the two test seasons. Its test figures flatter it a little for that.
- **The files are for one season.** `pipeline/config.py` names the season, and both opening files carry it. Before the first game of 2027-28 they have to be replaced: `elo.carried_over` and `points_rest.next_season` give the next season's opening state from this season's last, and the dates, the neutral floors and the altitudes of the new file have to be written by hand. The six coefficients are then a year old. Refitting them takes the results of earlier seasons, which are not here.

## Tests

| File | What it covers |
| --- | --- |
| `tests/test_pipeline_season.py` | The day of a game on both sides of 10:00 UTC and across the change of the clocks, the list of neutral floors by day and by pair of teams, the two files: 30 whole-number ratings that add up to 45,149 with New York, San Antonio and Oklahoma City on top, the constants, the 30 teams of the other file, the SHA-256 that identifies each, and the files that are refused. |
| `tests/test_pipeline_elo.py` | The rule against updates worked out by hand, that the two changes of a game are equal and opposite and leave the sum of the ratings as it was, the neutral floor, the day taken as a whole, the step between seasons, and the 1,320 games of FiveThirtyEight's 2022-23 season: every published chance, every published rating after a game, and the season replayed to the published ratings of June 2023. |
| `tests/test_pipeline_points_rest.py` | The port against the file of expected values, and each part of the method against the parameters: the home court on opening night, the two back-to-backs, the seven days, altitude, the playoff term, the neutral floor, what a result does to two ratings and their variances, the cap, the day taken as a whole, the forecasts that are refused, and the step to the next season. |
