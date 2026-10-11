/**
 * The matchup calculator of the Rankings view: two teams that a visitor
 * chooses, and Elo's chance for the home team, worked out on the page from
 * the two ratings in the model file and the file's home court. It is the sum
 * that pipeline/model/README.md says a reader can do.
 */
import type { Board, BoardGame } from '../data/board';
import type { ModelRatings } from '../data/model';
import { hasRow } from '../data/shape';
import { dayName, gameDay } from './day';
import { eloChance, eloGap, ELO_SCALE } from './methodElo';
import { chances, leaningSide, pickedSide, tenThousandths, type Side } from './pick';
import { teamName } from './teams';

/** Two teams as a game would have them, by their codes. */
export interface Matchup {
  away: string;
  home: string;
}

/** The away team first, as a game is called: `NYK-at-BOS`. */
const PARAM = /^([A-Za-z]{3})-at-([A-Za-z]{3})$/;

type Rated = Readonly<Record<string, unknown>>;

function isRated(ratings: Rated, code: string): boolean {
  return hasRow(ratings, code);
}

/**
 * The matchup that an address asks for, as in `#/rankings/NYK-at-BOS`. The
 * text is whatever a visitor typed, so it is null unless it names two
 * different teams that the file rates.
 */
export function matchupOf(param: string | null, ratings: Rated): Matchup | null {
  const match = param === null ? null : PARAM.exec(param);
  if (!match) return null;

  const [away, home] = [match[1].toUpperCase(), match[2].toUpperCase()];
  return away !== home && isRated(ratings, away) && isRated(ratings, home) ? { away, home } : null;
}

/** What follows the view in the address of a matchup. */
export function matchupParam({ away, home }: Matchup): string {
  return `${away}-at-${home}`;
}

/** The games on the board that have not started at `now`, the soonest first. */
function gamesToCome(board: Board, now: number): BoardGame[] {
  return board.games
    .filter((game) => Date.parse(game.commence_time) > now)
    .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time) || (a.id < b.id ? -1 : 1));
}

/**
 * The matchup the calculator opens with: the next game on the board, so
 * that the sum can be held against the chance on the game's card. Without
 * such a game it is the two teams that Elo rates highest, the higher one at
 * home. Null when the file rates fewer than two teams.
 */
export function defaultMatchup(board: Board, model: ModelRatings, now: number): Matchup | null {
  const { ratings } = model.elo;
  const next = gamesToCome(board, now).find((game) => game.home !== game.away && isRated(ratings, game.home) && isRated(ratings, game.away));
  if (next) return { away: next.away, home: next.home };

  const [home, away] = Object.keys(ratings).sort((a, b) => ratings[b].rating - ratings[a].rating || (a < b ? -1 : 1));
  return away === undefined ? null : { away, home };
}

/**
 * The matchup with another team on one side. A team cannot play itself: when
 * the team is the one on the other side, the two change places.
 */
export function withTeam(matchup: Matchup, side: Side, code: string): Matchup {
  const other: Side = side === 'home' ? 'away' : 'home';
  if (matchup[other] === code) return swapped(matchup);
  return { ...matchup, [side]: code };
}

/** The same two teams with the other one at home. */
export function swapped({ away, home }: Matchup): Matchup {
  return { away: home, home: away };
}

/** The teams a visitor can choose from, by name. */
export function teamChoices(model: ModelRatings): { code: string; name: string }[] {
  return Object.keys(model.elo.ratings)
    .map((code) => ({ code, name: teamName(code) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export interface MatchupTeam {
  code: string;
  name: string;
  /** The team's Elo rating in the file, a whole number. */
  rating: number;
  /** Its chance of winning in whole percent, as a card writes it. The two of a matchup add up to 100. */
  chance: number;
}

/** What the calculator shows of one matchup. */
export interface MatchupView {
  away: MatchupTeam;
  home: MatchupTeam;
  /** What Elo adds for the home team, from the file. */
  homeCourt: number;
  /** The home team's rating, plus the home court, minus the away team's rating. */
  gap: number;
  /** The home team's chance to four decimals, as the files write a chance. */
  pHome: number;
  /** The team that Elo picks, which is the one it puts at 52% or more. Null for a toss-up. */
  pick: MatchupTeam | null;
}

/** Null when the file does not rate both teams. */
export function matchupView(model: ModelRatings, { away, home }: Matchup): MatchupView | null {
  const { ratings, constants } = model.elo;
  if (!isRated(ratings, away) || !isRated(ratings, home)) return null;

  const [homeRating, awayRating] = [ratings[home].rating, ratings[away].rating];
  const pHome = eloChance(homeRating, awayRating, constants.home_court);
  const chance = chances(pHome);
  const teams = {
    away: { code: away, name: teamName(away), rating: awayRating, chance: chance.away },
    home: { code: home, name: teamName(home), rating: homeRating, chance: chance.home },
  };
  const side = pickedSide(pHome);
  return {
    ...teams,
    homeCourt: constants.home_court,
    gap: eloGap(homeRating, awayRating, constants.home_court),
    pHome,
    pick: side && teams[side],
  };
}

/**
 * What the calculator says under the two chances: the team that Elo picks,
 * or that it has none. A toss-up is given with all the decimals the chance
 * is worked out to, because the whole percent above it stops at 51% for a
 * chance of 51.5% or more, which is still short of a pick.
 */
export function pickNote(view: MatchupView): { lead: string; team: string | null; rest: string } {
  if (view.pick) return { lead: "Elo's pick: ", team: view.pick.name, rest: `, at ${view.pick.chance}%` };

  const side = leaningSide(view.pHome);
  if (side === null) return { lead: 'Toss-up: Elo has the two teams level', team: null, rest: '' };
  const home = tenThousandths(view.pHome);
  const chance = ((side === 'home' ? home : 10_000 - home) / 100).toFixed(2);
  return { lead: `Toss-up: Elo has the ${side} team at ${chance}%, short of the 52% that makes a pick`, team: null, rest: '' };
}

/** A whole number with the minus sign of the page, as a rating or a gap is written: "−73". */
export function wholeNumber(points: number): string {
  return points < 0 ? `−${Math.abs(points)}` : String(points);
}

/**
 * The chance as the formula gives it, in the parts a line of it is set
 * from: what 10 is raised to, written with the numbers of the matchup, and
 * the chance to four decimals. The formula takes the gap with its sign
 * turned, so a home team that is behind has no minus there.
 */
export function chanceFormula(view: MatchupView): { exponent: string; chance: string } {
  return { exponent: `${wholeNumber(-view.gap || 0)} / ${ELO_SCALE}`, chance: view.pHome.toFixed(4) };
}

/** What the board says of the same game, to hold next to the sum. */
export interface OnBoard {
  /** The day of the game, as "Sun, Nov 8". */
  day: string;
  /** Elo's chance on the board for the team that it leans to there, in whole percent, and that team's name. */
  team: string;
  chance: number;
  /** Whether the board has the very chance that the sum gives. */
  same: boolean;
}

/**
 * The next game on the board between the two teams with the same one at
 * home, when the board carries Elo's chance for it. Null when there is none.
 */
export function onBoard(board: Board, view: MatchupView, now: number): OnBoard | null {
  const game = gamesToCome(board, now).find((entry) => entry.home === view.home.code && entry.away === view.away.code);
  if (!game || game.elo === null) return null;

  const chance = chances(game.elo.p_home);
  const home = chance.home >= chance.away;
  return {
    day: dayName(gameDay(game.commence_time)),
    team: home ? view.home.name : view.away.name,
    chance: home ? chance.home : chance.away,
    same: game.elo.p_home === view.pHome,
  };
}

/** What the board says of the game, in a sentence or three, for under the sum. */
export function onBoardNote(found: OnBoard): string {
  if (found.same) return `This game is to be played on ${found.day}, and Elo's chance on its card is the same number.`;
  return (
    `This game is to be played on ${found.day}, and its card has ${found.team} at ${found.chance}% for Elo. That is the number that counts. ` +
    'It can differ from this sum: a game on a neutral floor has no home court, and the card can be of another morning than these ratings.'
  );
}
