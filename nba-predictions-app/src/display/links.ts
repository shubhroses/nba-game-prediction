/** The addresses outside the page that it links to. */

export const REPOSITORY = 'https://github.com/shubhroses/nba-game-prediction';

export const LINKS = {
  repository: REPOSITORY,
  /** The document of the two models, which says everything the How it works view says, at length. */
  models: `${REPOSITORY}/blob/main/pipeline/model/README.md`,
  /** The document of the job that publishes the files. */
  job: `${REPOSITORY}/blob/main/pipeline/README.md`,
  /** The branch that holds the published files. */
  data: `${REPOSITORY}/tree/data`,
  /** The data that FiveThirtyEight published, which holds the NBA Elo ratings that the opening ratings start from. */
  fiveThirtyEight: 'https://github.com/fivethirtyeight/data/tree/master/nba-forecasts',
  /** The license that FiveThirtyEight published its Elo ratings under. */
  license: 'https://creativecommons.org/licenses/by/4.0/',
} as const;
