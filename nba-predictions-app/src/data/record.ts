/**
 * The record, `v1/record.json` on the data branch: what the result lines add
 * up to for the sportsbooks' line and for each model. The job rebuilds it
 * from every result line once a day. The types follow schema 1 as
 * pipeline/README.md documents it, where "The record" says how each number
 * is worked out.
 */
import {
  bounds,
  count,
  day,
  expected,
  finite,
  list,
  object,
  oneOf,
  orNull,
  parsed,
  probability,
  schemaOne,
  score,
  share,
  teamCode,
  text,
  utcTime,
  type Parsed,
} from './shape';

/** The games whose favorite was given a chance within one band, such as 60% to 69%. */
export interface Band {
  /** `52-59`, `60-69`, `70-79`, `80-89` or `90+`. */
  band: string;
  games: number;
  /** How many of those favorites won. */
  wins: number;
  /** The mean chance those favorites were given. Null for a band without games. */
  mean_p_favorite: number | null;
}

/** A game that is over, as a list of the record names it. */
export interface RecordedGame {
  id: string;
  commence_time: string;
  home: string;
  away: string;
  home_pts: number;
  away_pts: number;
}

/** A favorite that lost. */
export interface Upset extends RecordedGame {
  /** The team code of the favorite. */
  favorite: string;
  /** The chance it was given. */
  p_favorite: number;
}

/** How the favorites of one source did. */
export interface Scorecard {
  /** The games in which the source had a favorite: `wins` plus `losses`. */
  games: number;
  wins: number;
  losses: number;
  /** `wins` divided by `games`. Null when no game had a favorite. */
  accuracy: number | null;
  /** The Wilson 95% interval of the accuracy. Null with the accuracy. */
  accuracy_interval: [number, number] | null;
  /** The games in which the source had neither side at 52%. */
  toss_ups: number;
  /** The games the source had no forecast for, or one that came too late to count. */
  not_graded: number;
  /** The games with a forecast that counts, favorite or not: the games that `brier` and `log_loss` are of. */
  with_line: number;
  /** Lower is better for both. One half for every game scores 0.25 and 0.6931. Null without such a game. */
  brier: number | null;
  log_loss: number | null;
  /** Always the five bands, in order. */
  bands: Band[];
  /** Up to three, the favorite with the highest chance first. */
  biggest_upsets: Upset[];
}

/** A game in which a model and the sportsbooks picked different winners. */
export interface DifferentPick extends RecordedGame {
  /** The team code the model picked. */
  pick: string;
  /** The team code the sportsbooks picked. */
  market_pick: string;
  right: 'model' | 'market';
}

/** How the forecasts of one model did, and how they did next to the sportsbooks' line. */
export interface ModelScorecard extends Scorecard {
  /** The games whose forecast was published at or after the start. They are among `not_graded`. */
  late: number;
  picks_against_market: {
    /** The games in which both had a favorite and the two were not the same side. */
    differ: number;
    model_right: number;
    market_right: number;
    /** Up to ten of those games, the latest first. */
    latest: DifferentPick[];
  };
  brier_against_market: {
    /** The games that both have a chance for. */
    games: number;
    /** The model's Brier score minus the sportsbooks' over those games. Null without such a game. */
    difference: number | null;
    /** Its 95% interval. Null below 30 games. */
    interval: [number, number] | null;
  };
}

/** What one day's games came to for one source. */
export interface DayTally {
  wins: number;
  losses: number;
  toss_ups: number;
  not_graded: number;
}

export interface RecordDay {
  /** The New York calendar date the games started on. */
  day: string;
  games: number;
  market: DayTally;
  /** Null in a sport that is not forecast. */
  elo: DayTally | null;
  points_rest: DayTally | null;
}

export interface SeasonRecord {
  schema: 1;
  sport: string;
  /** The day of the first game in the record. Null when there is no game yet. */
  since: string | null;
  /** The games recorded. */
  games: number;
  /** How the sportsbooks' line did. */
  market: Scorecard;
  /** Null in a sport that is not forecast. */
  elo: ModelScorecard | null;
  points_rest: ModelScorecard | null;
  /** The home team every time: the games recorded and the home wins among them. */
  baseline_home: { games: number; wins: number };
  /** One entry for each day that has a game, in order. */
  by_day: RecordDay[];
}

const RIGHT = ['model', 'market'] as const;

function band(value: unknown, path: string): Band {
  const fields = object(value, path);
  return {
    band: text(fields.band, `${path}.band`),
    games: count(fields.games, `${path}.games`),
    wins: count(fields.wins, `${path}.wins`),
    mean_p_favorite: orNull(fields.mean_p_favorite, `${path}.mean_p_favorite`, share),
  };
}

function recordedGame(fields: Record<string, unknown>, path: string): RecordedGame {
  return {
    id: text(fields.id, `${path}.id`),
    commence_time: utcTime(fields.commence_time, `${path}.commence_time`),
    home: teamCode(fields.home, `${path}.home`),
    away: teamCode(fields.away, `${path}.away`),
    home_pts: count(fields.home_pts, `${path}.home_pts`),
    away_pts: count(fields.away_pts, `${path}.away_pts`),
  };
}

/** A team that a list names next to its game has to be one of the two that played it. */
function teamOf(game: RecordedGame, value: unknown, path: string): string {
  if (value === game.home) return game.home;
  if (value === game.away) return game.away;
  return expected('one of the two teams of the game', path);
}

function upset(value: unknown, path: string): Upset {
  const fields = object(value, path);
  const game = recordedGame(fields, path);
  return {
    ...game,
    favorite: teamOf(game, fields.favorite, `${path}.favorite`),
    p_favorite: probability(fields.p_favorite, `${path}.p_favorite`),
  };
}

function differentPick(value: unknown, path: string): DifferentPick {
  const fields = object(value, path);
  const game = recordedGame(fields, path);
  return {
    ...game,
    pick: teamOf(game, fields.pick, `${path}.pick`),
    market_pick: teamOf(game, fields.market_pick, `${path}.market_pick`),
    right: oneOf(RIGHT, fields.right, `${path}.right`),
  };
}

function scorecard(value: unknown, path: string): Scorecard {
  const fields = object(value, path);
  return {
    games: count(fields.games, `${path}.games`),
    wins: count(fields.wins, `${path}.wins`),
    losses: count(fields.losses, `${path}.losses`),
    accuracy: orNull(fields.accuracy, `${path}.accuracy`, share),
    accuracy_interval: orNull(fields.accuracy_interval, `${path}.accuracy_interval`, (interval, where) =>
      bounds(interval, where, share),
    ),
    toss_ups: count(fields.toss_ups, `${path}.toss_ups`),
    not_graded: count(fields.not_graded, `${path}.not_graded`),
    with_line: count(fields.with_line, `${path}.with_line`),
    brier: orNull(fields.brier, `${path}.brier`, score),
    log_loss: orNull(fields.log_loss, `${path}.log_loss`, score),
    bands: list(fields.bands, `${path}.bands`, band),
    biggest_upsets: list(fields.biggest_upsets, `${path}.biggest_upsets`, upset),
  };
}

/** A sport that is not forecast has no field for a model, and that counts as null. */
function modelScorecard(value: unknown, path: string): ModelScorecard | null {
  if (value === undefined) return null;
  const fields = object(value, path);
  const picks = object(fields.picks_against_market, `${path}.picks_against_market`);
  const brier = object(fields.brier_against_market, `${path}.brier_against_market`);
  return {
    ...scorecard(fields, path),
    late: count(fields.late, `${path}.late`),
    picks_against_market: {
      differ: count(picks.differ, `${path}.picks_against_market.differ`),
      model_right: count(picks.model_right, `${path}.picks_against_market.model_right`),
      market_right: count(picks.market_right, `${path}.picks_against_market.market_right`),
      latest: list(picks.latest, `${path}.picks_against_market.latest`, differentPick),
    },
    brier_against_market: {
      games: count(brier.games, `${path}.brier_against_market.games`),
      difference: orNull(brier.difference, `${path}.brier_against_market.difference`, finite),
      interval: orNull(brier.interval, `${path}.brier_against_market.interval`, (interval, where) =>
        bounds(interval, where, finite),
      ),
    },
  };
}

function dayTally(value: unknown, path: string): DayTally {
  const fields = object(value, path);
  return {
    wins: count(fields.wins, `${path}.wins`),
    losses: count(fields.losses, `${path}.losses`),
    toss_ups: count(fields.toss_ups, `${path}.toss_ups`),
    not_graded: count(fields.not_graded, `${path}.not_graded`),
  };
}

function recordDay(value: unknown, path: string): RecordDay {
  const fields = object(value, path);
  return {
    day: day(fields.day, `${path}.day`),
    games: count(fields.games, `${path}.games`),
    market: dayTally(fields.market, `${path}.market`),
    elo: fields.elo === undefined ? null : dayTally(fields.elo, `${path}.elo`),
    points_rest: fields.points_rest === undefined ? null : dayTally(fields.points_rest, `${path}.points_rest`),
  };
}

function record(value: unknown): SeasonRecord {
  const fields = object(value, 'the record');
  const baseline = object(fields.baseline_home, 'baseline_home');
  return {
    schema: schemaOne(fields.schema),
    sport: text(fields.sport, 'sport'),
    since: orNull(fields.since, 'since', day),
    games: count(fields.games, 'games'),
    market: scorecard(fields.market, 'market'),
    elo: modelScorecard(fields.elo, 'elo'),
    points_rest: modelScorecard(fields.points_rest, 'points_rest'),
    baseline_home: { games: count(baseline.games, 'baseline_home.games'), wins: count(baseline.wins, 'baseline_home.wins') },
    by_day: list(fields.by_day, 'by_day', recordDay),
  };
}

/**
 * Checks that a value has the shape of a schema 1 record and returns it with
 * the documented fields only. The fields of a model, which the record of a
 * sport that is not forecast does not have, come out as null.
 */
export function parseRecord(value: unknown): Parsed<SeasonRecord> {
  return parsed(() => record(value));
}
