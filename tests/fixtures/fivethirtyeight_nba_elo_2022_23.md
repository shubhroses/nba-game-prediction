# `fivethirtyeight_nba_elo_2022_23.csv`

The 1,320 games of the 2022-23 NBA season, which are the regular season, the play-in games and the playoffs, with the Elo rating of both teams before and after each game.

- **Source.** FiveThirtyEight, NBA Elo, the file `nba_elo.csv` that is listed in [`nba-forecasts`](https://github.com/fivethirtyeight/data/tree/master/nba-forecasts) of FiveThirtyEight's data repository as `https://projects.fivethirtyeight.com/nba-model/nba_elo.csv`. The rows here were taken from a copy of that file kept by the Internet Archive. It ends with the last game of the finals, on 12 June 2023.
- **License.** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0), which the README of that repository gives for its data sets.
- **Changes.** This is an extract. It holds the rows whose `season` is 2023 and 13 of the file's 27 columns: `date`, `season`, `neutral`, `playoff`, `team1`, `team2`, `elo1_pre`, `elo2_pre`, `elo_prob1`, `elo1_post`, `elo2_post`, `score1` and `score2`. No value was changed.

`team1` is the home team. FiveThirtyEight computed these ratings with a home court of 100 points. `tests/test_pipeline_elo.py` holds the rule in `pipeline/model/elo.py` to every row.
