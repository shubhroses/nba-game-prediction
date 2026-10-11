/**
 * What the Rankings view shows of the model file: the sentence that says
 * what the ratings rest on, what the job found when it left a model out, and
 * the rows of the table in the order of either model.
 */
import type { ModelRatings, PointsRating } from '../data/model';
import { dayName } from './day';
import { countOf, signedPoints, winsLosses } from './numbers';
import { teamName } from './teams';

/** The model whose ratings the table is in the order of. */
export type RankBy = 'points_rest' | 'elo';

export interface RatingsBasis {
  /** True before the first result of the season: the ratings are the ones the season opens with. */
  opening: boolean;
  /** What the ratings rest on, in a sentence or two. */
  text: string;
}

/**
 * What the ratings rest on: every result through a day, or nothing yet. The
 * job replays the whole season every morning, so the day of the last result
 * says all of it.
 */
export function ratingsBasis(model: ModelRatings): RatingsBasis {
  if (model.results_through === null) {
    return {
      opening: true,
      text:
        `No game of the ${model.season} season is on record yet. Each rating is last season's, moved a quarter of the way ` +
        "toward the league's average for Elo and a fifth for Points & Rest, so a summer's trades and the draft are not in it. " +
        "Wins, losses and the week's change will show from the first results on.",
    };
  }
  return {
    opening: false,
    text:
      `Every result on record through ${dayName(model.results_through)} is in these ratings: ` +
      `${countOf(model.games, 'game')} of the ${model.season} season.`,
  };
}

export interface RatingsNotice {
  title: string;
  text: string;
  /** What the job found in the results, one sentence for each thing, as the file gives them. */
  reasons: string[];
}

/**
 * What to say above the table when the file is not as it is on a good day.
 * Null when it is. The job leaves Points & Rest out when the results did not
 * pass its checks, and publishes Elo alone.
 */
export function ratingsNotice(model: ModelRatings): RatingsNotice | null {
  if (model.points_rest === null) {
    return {
      title: 'Points & Rest is left out today',
      text:
        model.status === 'degraded'
          ? "The results did not pass the checks of the job's last daily run. Points & Rest counts rest, which it cannot do " +
            'from results that have a gap or a game twice, so only the ratings of Elo are published.'
          : 'The file holds no ratings of Points & Rest today, so the table shows Elo alone.',
      reasons: model.reasons,
    };
  }
  if (model.status === 'degraded') {
    return {
      title: "The results did not pass the checks of the job's last daily run",
      text: 'The file holds the ratings of both models all the same.',
      reasons: model.reasons,
    };
  }
  return null;
}

/** The orders the table can be in: either model, or Elo alone when the file leaves the other one out. */
export function rankChoices(model: ModelRatings): RankBy[] {
  return model.points_rest ? ['points_rest', 'elo'] : ['elo'];
}

export interface EloMove {
  /** Which way the rating went since a week before the last result. */
  direction: 'up' | 'down' | 'none';
  /** By how many points. Never below zero. */
  points: number;
  /** The same for a visitor who cannot see an arrow: "up 4", "down 17", "no change". */
  words: string;
}

/** How far a rating has moved from what it was a week before the last result. */
export function eloMove(rating: number, weekAgo: number): EloMove {
  const points = Math.abs(rating - weekAgo);
  if (points === 0) return { direction: 'none', points, words: 'no change' };
  return rating > weekAgo ? { direction: 'up', points, words: `up ${points}` } : { direction: 'down', points, words: `down ${points}` };
}

/**
 * Where a rating in points lies on a bar whose middle is an average team.
 * Every number is a share of the bar's width, counted from its left end.
 */
export interface RatingBar {
  /** Where the fill starts and where it ends. One of the two is the middle, 0.5. */
  from: number;
  to: number;
  /** The rating less its uncertainty and the rating plus it, which a line across the end of the fill shows. */
  low: number;
  high: number;
}

/**
 * How many points either end of the bars stands for. The bars of a table
 * share one scale: the next multiple of five that holds every rating with
 * its uncertainty, and never less than ten.
 */
export function barExtent(ratings: readonly PointsRating[]): number {
  const reach = Math.max(0, ...ratings.map(({ rating, uncertainty }) => Math.abs(rating) + uncertainty));
  return Math.max(10, Math.ceil(reach / 5) * 5);
}

export function ratingBar({ rating, uncertainty }: PointsRating, extent: number): RatingBar {
  const share = (points: number) => Math.min(1, Math.max(0, 0.5 + points / (2 * extent)));
  const end = share(rating);
  return { from: Math.min(0.5, end), to: Math.max(0.5, end), low: share(rating - uncertainty), high: share(rating + uncertainty) };
}

/**
 * An uncertainty as "±2.6". The file gives it to two decimals, and half of
 * the last digit goes up, as it does in every number of points on the page.
 */
export function plusMinus(uncertainty: number): string {
  return `±${signedPoints(Math.abs(uncertainty)).replace('+', '')}`;
}

/** One team in the table. */
export interface RankingRow {
  /** The three-letter code. */
  code: string;
  name: string;
  /**
   * The team's place in the order. Teams that show the same rating share a
   * place, and the places after them are left out: three teams at 11 are
   * followed by the team at 14.
   */
  rank: number;
  /** Wins and losses in the results of the season that are on record, as "5–4" and in words. */
  record: string;
  recordWords: string;
  /** Null when the file leaves Points & Rest out. */
  pointsRest: {
    /** In points against an average team: "+7.4". */
    rating: string;
    /** How well the model knows the rating, as one standard deviation: "±2.6". */
    uncertainty: string;
    bar: RatingBar;
  } | null;
  elo: {
    /** A whole number. */
    rating: number;
    move: EloMove;
  };
}

export interface Rankings {
  /** The model the rows are in the order of. It is Elo when the file has no other. */
  by: RankBy;
  rows: RankingRow[];
  /** How many points either end of a bar stands for. Null when the file leaves Points & Rest out. */
  extent: number | null;
}

/**
 * The table of every team that the file rates, the highest rating first.
 * Teams that the file rates the same are put in the order of the other
 * model, and after that by name.
 *
 * A place goes by the rating as the table writes it. The file gives a rating
 * of Points & Rest to two decimals and the table writes one, so a place
 * taken from the file would give two teams that both read −1.3 two
 * different places. Among the teams of one place the order is the file's.
 */
export function rankings(model: ModelRatings, wanted: RankBy): Rankings {
  const points = model.points_rest?.ratings ?? null;
  const by: RankBy = points ? wanted : 'elo';
  const extent = points && barExtent(Object.values(points));

  const teams = Object.entries(model.elo.ratings).map(([code, elo]) => ({
    code,
    name: teamName(code),
    elo,
    points: points?.[code] ?? null,
    played: model.teams[code],
  }));
  const eloOf = (team: (typeof teams)[number]) => team.elo.rating;
  const pointsOf = (team: (typeof teams)[number]) => team.points?.rating ?? 0;
  const [first, second] = by === 'elo' ? [eloOf, pointsOf] : [pointsOf, eloOf];
  teams.sort((a, b) => first(b) - first(a) || second(b) - second(a) || (a.name < b.name ? -1 : 1));

  // What the table writes of each team in the model it is ranked by. Rounding keeps the order, so the teams
  // that are written the same stand one after another, and the first of them has as many teams before it as
  // are written higher.
  const written = teams.map((team) => (by === 'elo' ? String(eloOf(team)) : signedPoints(pointsOf(team))));

  const rows = teams.map((team, index): RankingRow => ({
    code: team.code,
    name: team.name,
    rank: 1 + written.indexOf(written[index]),
    record: winsLosses(team.played.wins, team.played.losses),
    recordWords: `${countOf(team.played.wins, 'win')} and ${countOf(team.played.losses, 'loss', 'losses')}`,
    pointsRest:
      team.points && extent !== null
        ? { rating: signedPoints(team.points.rating), uncertainty: plusMinus(team.points.uncertainty), bar: ratingBar(team.points, extent) }
        : null,
    elo: { rating: team.elo.rating, move: eloMove(team.elo.rating, team.elo.week_ago) },
  }));
  return { by, rows, extent };
}

/** What the ends and the middle of the bars stand for, as the head of the column writes them: "−15", "0", "+15". */
export function barAxis(extent: number): [string, string, string] {
  return [signedPoints(-extent, 0), '0', signedPoints(extent, 0)];
}
