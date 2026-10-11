# Sample data: an invented season in progress

The files that the page reads, as the job publishes them on the `data` branch, so that the page can be built, tested and looked at before the real season has a result.

**Nothing in them happened.** The schedule, the sportsbooks' prices and the final scores are invented, and so is how good each team is: the rating that the points-and-rest model opens the season with, moved by an invented amount. The sportsbooks are called Book A to Book F. What is real are the 30 teams and one fixture, Indiana against Denver on 7 November, and of that game the time, the prices and the score are invented as well. The numbers say nothing about how the two models do against real sportsbooks.

The files are not written by hand. `tests/sample_season.py` plays the invented games through the real job, slot by slot from 05:10 on 20 October 2026 to 18:10 on 8 November, New York time, against a local stand-in for the odds provider. So every field is the one that `pipeline/README.md` documents under "The files", and the forecasts are what the job's two models make of the invented results.

| File | What is in it |
| --- | --- |
| `v1/slate.json` | The board of the last snapshot: 26 games to come, the record, and the 60 results of the last eight days. |
| `v1/record.json` | The record after 143 games: 83 wins and 48 losses for the sportsbooks' favorite, 73 and 43 for Elo's, 72 and 44 for the points-and-rest model's. |
| `v1/model.json` | Where both models stand after the results of 7 November. |
| `v1/predictions/2026-10-31.json` to `2026-11-06.json` | The forecasts of the seven days before Saturday, one file for each day. Their games are over, and all but three of them are among the results on the board. |
| `v1/predictions/2026-11-07.json` | The forecasts of Saturday, whose six games are over and graded. |
| `v1/predictions/2026-11-08.json` | The forecasts of Sunday, the day it stops on. |

## The moment it stops at

The last snapshot is the one of the 18:10 slot on Sunday 8 November 2026, taken at `2026-11-08T23:10:21Z`. Preview the page with its clock at `2026-11-08T23:30:00Z`. Two of Sunday's games have started by then and have no result, because results are recorded once a day, in the morning.

## The states it holds

A game is named by its `id`. A result carries the start that the scores give, to the second, which is some minutes after the scheduled start in the forecasts and on the board, so a game is matched by `id` and not by its time. `code_commit` is `null` in every file that has it.

The page asks for the forecasts of one day, the day that the board carries: 8 November. The files of the eight days before it are here as well, one for each day that the board has a result of. The page's tests read them, and a view that asked for one of those days would find its file.

**Sunday 8 November.** Seven games have frozen forecasts of both models in `predictions/2026-11-08.json`. The first two are not on the board. The other five are, with those forecasts.

| Game | `id` | Start, UTC | What it shows |
| --- | --- | --- | --- |
| Washington at New York | `581e86cc9475dc891bd292041d4c6e43` | 20:30 | It has started and has no result yet. All three have New York at 94% or 95%. |
| The Clippers at Detroit | `1125672ec18b40642d961db4c84e8e93` | 23:00 | It started ten minutes before the snapshot. The points-and-rest model has no favorite, at 49.9%. |
| Portland at Cleveland | `2ff3bb0a26d458b063af611abe3a697c` | 00:10 | The sportsbooks pick Portland, at 58.9%. Both models pick Cleveland: 59.5% for points and rest, 65.8% for Elo. |
| Boston at Toronto | `25e99a99a8a9caddeb5519ff7fcdcc07` | 00:40 | The sportsbooks' line is a toss-up, at 49.9%. |
| Memphis at Minnesota | `aa76ef3a1faa6c53ef65fdbeb024cb00` | 01:40 | One sportsbook quotes it: `n` is 1 and `books` is empty. |
| Charlotte at Utah | `ada9687fdc017e3766595da849973a44` | 02:10 | Charlotte played the evening before, so `rest_edge` is 1.39, and Utah's altitude makes `home_court` 1.91. All three pick Charlotte. |
| Philadelphia at the Lakers | `205aac335470099327c0ca04f2155d62` | 03:40 | All three pick the Lakers. |

The board also lists 21 games of 9, 10 and 11 November, which have Elo's chance and nothing of the other model. Seven of them, all on the 11th, have no line yet: `5148594dbb08b153499cd6bba0b6e988`, `5cb4082dc92631d157eb56aca48f6e40`, `d574799d01ce01098a32d34cde7ce830`, `faae0737392caa342d0acdd1ba1c4fc1`, `a3b18753ea65156b6bfee5c49506454b`, `b121b67ba1f3b019e46aaea1dcfc2b1f`, `343a9744104f415dfab41551632c501f`. Three have a line from a single sportsbook: `147433a6a24a25c26aac2b099420ebc6`, `51547459a7e5121a29d410933473e3e9`, `c1151adb346c172be061eff0a157d09c`.

**Saturday 7 November**, in `predictions/2026-11-07.json` and among the results on the board:

- `13cdfd29ad5724383cbe4b721c1b8959`, Denver against Indiana in Mexico City: `neutral` is true, and the home court is 0 in both forecasts.
- `37430b64fbcb5683d46e277336cd074f`, Orlando at Charlotte: no sportsbook ever quoted it. `market` is `null` in the forecast and in the result, the sportsbooks' verdict is `not_graded`, and both models are graded.
- `1a20c36414d0a2b65a914da38cde8743`, Dallas at Chicago: both models picked Chicago and the sportsbooks Dallas, which won. It is the first entry of `picks_against_market.latest` for both models.
- `6796f9789fb03365664fd9f44404df86`, Golden State at Phoenix: the sportsbooks' line was a toss-up, and both models picked Phoenix, which lost.

**Earlier days:**

- **A score that came a day late.** `f2699d4366ea6f7f96b4243432d380a1`, Denver at the Clippers on 1 November, was missing from the scores on the morning of the 2nd and is recorded on the 3rd. The points-and-rest model was left out on 2 November for that reason: `predictions/2026-11-02.json` has the status `degraded` and names the game in its one reason. So the six games of that day have Elo's forecast alone: `f897686e61c22ea5ac8cc31bf6640e67`, `73dbb4950f85cd7658caaa9ea63d885f`, `63c84df74b6b466cc24105744f0aedca`, `2be2631182e70a308a68f50ffd5126bc`, `96eb9f8299c6c8b27c5da43f70dd1851`, `246ecb42217f3d26caf9a19ac11074e4`. `by_day` counts all six as not graded for `points_rest`. Both models are back on the 3rd, and `status` is `ok` in every other file here.
- **A day of results that is cut.** The board keeps a result for eight days from the start of its game. `predictions/2026-10-31.json` has nine games. The three that started in the afternoon, `2b7a26396aaa987d7c99228193eb6283`, `c0eaefe9518ae8f4588eb1054fe5f68a` and `c41ff1100b759398c4aecdbcc3b2d694`, are no longer among the results on the board, and the six of the evening are. `by_day` still counts nine games for that day.
- **A morning without a run.** No run came in the 05:10 slot of 27 October. The ten games of that day have no forecast of either model, which `by_day` counts as not graded, and the run of the 28th recorded two evenings.
- **Opening night.** The first run knew no game when it did its daily work, so the six games of 20 October have no forecast either.
- **Favorites at 75% or more that lost.** `market.biggest_upsets` lists three: `46e36f1a9c7a66a59068c441ba2a95e1`, Miami at 88%, at home to Chicago on 5 November, `b84751053871900c8d74eb1f1e346207`, Golden State at 84%, and `de90333a375cf61a1b38458a7ca41d56`, New York at 80%.
- **Lines without a favorite.** The record has eleven. Five are among the results on the board: `459cab4f97d31a45cfa99bc91cfc04e5`, `803869a581e0040bc8f4f3524e17d8ff`, `e3793f3bbf4d6dd5ddddfef90967d9ad`, `4e0c88a4aa080ff6963b646157cdf3d0`, `6796f9789fb03365664fd9f44404df86`.
- **Different picks.** Each model and the sportsbooks picked different winners in 15 games. The model's pick won 7 of them and the sportsbooks' 8.
- **The difference in Brier score** has an interval for both models, and both intervals include zero: 0.0067 against Elo over 126 games, from -0.0128 to 0.0270, and 0.0028 against the points-and-rest model over 120, from -0.0168 to 0.0229.

## Rebuilding it

From the root of the repository:

```
python -m tests.sample_season --sample-data
```

It needs Python 3.11 or newer and nothing else, and it writes the same bytes every time. `tests/test_sample_season.py` fails when the files here are not what the command writes. That is so after a change to what the job writes, and also after a change to one of the opening files in `pipeline/model/`, because the files here carry the SHA-256 of both.
