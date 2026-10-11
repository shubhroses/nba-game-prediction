/**
 * The model file, `v1/model.json` on the data branch: where the two models
 * stand after the results that are on record. The job rebuilds it once a
 * day. Only a sport that is forecast has one. The types follow schema 1 as
 * pipeline/README.md documents it.
 */
import { modelStatus, parameters, reasons, type ModelStatus, type Parameters } from './forecasts';
import {
  count,
  day,
  expected,
  finite,
  hasRow,
  object,
  objectOrNull,
  orNull,
  parsed,
  schemaOne,
  teamTable,
  text,
  utcTime,
  wholeNumber,
  type Parsed,
} from './shape';

export interface EloRating {
  /** A whole number. The league's mean is 1505. */
  rating: number;
  /** The rating after the results of the day seven days before `results_through`. */
  week_ago: number;
}

export interface PointsRating {
  /** In points against an average team. */
  rating: number;
  /** The standard deviation of the rating after the team's last game, in points. */
  uncertainty: number;
}

export interface ModelRatings {
  schema: 1;
  sport: string;
  /** The season of the opening files, such as `2026-27`. */
  season: string;
  built_at: string;
  /** The day of the last result that was replayed. Null before the first result of the season. */
  results_through: string | null;
  /** The results of the season that were replayed. */
  games: number;
  status: ModelStatus;
  /** One sentence for each thing found in the results. Empty when the status is `ok`. */
  reasons: string[];
  parameters: Parameters;
  /** The commit of the code the job ran from. Null when the run was not told. */
  code_commit: string | null;
  elo: {
    constants: { k: number; home_court: number; mean: number; reversion: number };
    /** One row for each team, by its code. */
    ratings: Record<string, EloRating>;
  };
  /** Null when the status is `degraded`. */
  points_rest: {
    /** The league's home court in points, as the results have moved it. */
    home_court: number;
    /** One row for each team of `elo.ratings`. */
    ratings: Record<string, PointsRating>;
  } | null;
  /** The wins and the losses of each team of `elo.ratings` in the results of the season that are on record. */
  teams: Record<string, { wins: number; losses: number }>;
}

function eloRating(value: unknown, path: string): EloRating {
  const fields = object(value, path);
  return { rating: wholeNumber(fields.rating, `${path}.rating`), week_ago: wholeNumber(fields.week_ago, `${path}.week_ago`) };
}

function pointsRating(value: unknown, path: string): PointsRating {
  const fields = object(value, path);
  const uncertainty = finite(fields.uncertainty, `${path}.uncertainty`);
  if (uncertainty <= 0) expected('a number above 0', `${path}.uncertainty`);
  return { rating: finite(fields.rating, `${path}.rating`), uncertainty };
}

function winsAndLosses(value: unknown, path: string): { wins: number; losses: number } {
  const fields = object(value, path);
  return { wins: count(fields.wins, `${path}.wins`), losses: count(fields.losses, `${path}.losses`) };
}

/**
 * The three tables are read side by side, so each has to have a row for
 * every team that Elo rates.
 */
function sameTeams(rated: Record<string, unknown>, table: Record<string, unknown>, path: string): void {
  const teams = Object.keys(rated);
  if (Object.keys(table).length !== teams.length || !teams.every((team) => hasRow(table, team))) {
    expected('a table of the teams in elo.ratings', path);
  }
}

function model(value: unknown): ModelRatings {
  const fields = object(value, 'the model file');
  const elo = object(fields.elo, 'elo');
  const constants = object(elo.constants, 'elo.constants');
  const ratings = teamTable(elo.ratings, 'elo.ratings', eloRating);

  const points = objectOrNull(fields.points_rest, 'points_rest');
  const pointsRatings = points && teamTable(points.ratings, 'points_rest.ratings', pointsRating);
  if (pointsRatings) sameTeams(ratings, pointsRatings, 'points_rest.ratings');
  const teams = teamTable(fields.teams, 'teams', winsAndLosses);
  sameTeams(ratings, teams, 'teams');

  return {
    schema: schemaOne(fields.schema),
    sport: text(fields.sport, 'sport'),
    season: text(fields.season, 'season'),
    built_at: utcTime(fields.built_at, 'built_at'),
    results_through: orNull(fields.results_through, 'results_through', day),
    games: count(fields.games, 'games'),
    status: modelStatus(fields.status, 'status'),
    reasons: reasons(fields.reasons, 'reasons'),
    parameters: parameters(fields.parameters, 'parameters'),
    code_commit: orNull(fields.code_commit, 'code_commit', text),
    elo: {
      constants: {
        k: finite(constants.k, 'elo.constants.k'),
        home_court: finite(constants.home_court, 'elo.constants.home_court'),
        mean: finite(constants.mean, 'elo.constants.mean'),
        reversion: finite(constants.reversion, 'elo.constants.reversion'),
      },
      ratings,
    },
    points_rest: points && pointsRatings && { home_court: finite(points.home_court, 'points_rest.home_court'), ratings: pointsRatings },
    teams,
  };
}

/**
 * Checks that a value has the shape of a schema 1 model file and returns it
 * with the documented fields only.
 */
export function parseModel(value: unknown): Parsed<ModelRatings> {
  return parsed(() => model(value));
}
