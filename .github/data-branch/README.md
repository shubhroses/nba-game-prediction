# Odds snapshots and results

This branch holds data, not code. The `Odds snapshot` workflow on the `main` branch adds a commit here for each snapshot it takes, normally six a day. Each commit records, for every upcoming NBA game, the home team's chance of winning as US sportsbooks price it. Once a day, with the first snapshot of the day, it also records how the games that are over ended and whether the side that the sportsbooks favored won.

Do not edit the files by hand. The job reads back what it wrote. It refuses to continue from a state file it cannot check, to change a history line or a result that is already there, and to add to results files it cannot check.

| Path | What it is |
| --- | --- |
| `v1/slate.json` | The board: the upcoming games as of the latest snapshot, each with its line in that snapshot and its opening line, the sportsbooks' wins and losses so far, and the results of the last eight days. Replaced by every snapshot. |
| `v1/state.json` | What the job remembers between runs: the last slot it recorded, the API credits left, the first and the latest line of each game, and what the daily work last noted. A game stays until 14 days after its start. |
| `v1/history/YYYY-MM-DD.ndjson` | One line per game per snapshot, in one file per UTC date. Lines are only ever added. |
| `v1/results/YYYY-MM.ndjson` | One line per game that is over, in one file per UTC month of the games' starts: the final score, the game's last line from before its start, and the verdict on that line. Lines are only ever added, and a game is recorded once. |
| `v1/record.json` | What the results add up to: the wins and losses of the sportsbooks' favorite, the accuracy with a 95% interval, the Brier score and the log loss of the lines, what the home team every time would have won, the results by band of the favorite's probability and by day, and the three biggest upsets. Rebuilt from all result lines once a day. |
| `v1-dryrun/` | The same files for preseason games, written until 17 October 2026 to rehearse the job on real games. It is not part of the record. |
| `nba-predictions-app/vercel.json` | Not data. Vercel builds the `nba-predictions-app` folder of every branch that is pushed to this repository, and this file tells it not to deploy this one. |

The fields of each file, the grading rules, the schedule and the rules the job follows are described in [`pipeline/README.md` on `main`](https://github.com/shubhroses/nba-game-prediction/blob/main/pipeline/README.md). `schema` is 1 in the JSON files and stays 1 when a field is added, so a reader has to ignore the fields it does not know.

Of the odds, the files hold derived figures only: for each game the median, the lowest and the highest of the sportsbooks' home win probabilities with each sportsbook's margin removed, the number of sportsbooks, and their names when there are two or more that do not all give the same probability. The responses of the odds provider and the prices in them are not published. Of the scores, the files hold the final score of each game that is over.
