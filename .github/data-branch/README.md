# Odds snapshots

This branch holds data, not code. The `Odds snapshot` workflow on the `main` branch adds a commit here up to six times a day. Each commit records, for every upcoming NBA game, the home team's chance of winning as US sportsbooks price it.

Do not edit the files by hand. The job reads back what it wrote, and it refuses to continue from a state file it cannot check or to change a history line that is already there.

| Path | What it is |
| --- | --- |
| `v1/slate.json` | The board: the upcoming games as of the latest snapshot, each with its line in that snapshot and its opening line. Replaced by every snapshot. |
| `v1/state.json` | What the job remembers between runs: the last slot it recorded, the API credits left, and the first and the latest line of each game. A game stays until 14 days after its start. |
| `v1/history/YYYY-MM-DD.ndjson` | One line per game per snapshot, in one file per UTC date. Lines are only ever added. |
| `v1-dryrun/` | The same three files for preseason games, written until 17 October 2026 to rehearse the grading step on real games. It is not part of the record. |
| `nba-predictions-app/vercel.json` | Not data. Vercel builds the `nba-predictions-app` folder of every branch that is pushed to this repository, and this file tells it not to deploy this one. |

The fields of each file, the schedule and the rules the job follows are described in [`pipeline/README.md` on `main`](https://github.com/shubhroses/nba-game-prediction/blob/main/pipeline/README.md).

The files hold derived figures only: for each game the median, the lowest and the highest of the sportsbooks' home win probabilities with each sportsbook's margin removed, and the number and the names of the sportsbooks. The responses of the odds provider and the prices in them are not published.
