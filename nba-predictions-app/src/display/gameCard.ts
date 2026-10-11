/**
 * What the card of one game shows, as plain data: the two teams with the
 * chance the card leads with, the three sources under each other, one
 * sentence on how the models stand to the sportsbooks, and how each number
 * is made. A game on the board and a game that has left it for the
 * forecasts file of its day are drawn as the same card.
 *
 * Nothing here works a number out that the files do not hold. A chance is
 * the published one, a pick follows the rule of display/pick.ts, and a
 * source without a number gets words that say why.
 */
import type { Board, BoardGame, OpeningLine } from '../data/board';
import type { Consensus, PointsRestForecast } from '../data/forecasts';
import type { ModelRatings } from '../data/model';
import type { DayPredictions, PredictedGame } from '../data/predictions';
import { hasRow } from '../data/shape';
import { formatDate, formatTime } from '../utils/formatters';
import { gameDay } from './day';
import { signedPoints } from './numbers';
import { chances, leaningSide, pickedSide, pickLabel, picksDiffer, TOSS_UP, wholePercent, type Side } from './pick';
import { missingPointsRest, type MissingPointsRest } from './pointsRest';
import { matchupParam } from './rankingsMatchup';
import { hrefOf } from './route';
import { MODELS, source, SOURCES, type SourceKey } from './sources';
import { nameInSentence, shortName, teamName } from './teams';
import { listed } from './words';

/** The two ratings that Elo's chance for a game comes from, and what the home team gets on top. */
export interface EloInputs {
  home: number;
  away: number;
  /** In rating points: 40, or 0 on a neutral floor. */
  homeCourt: number;
  /** Null when the ratings are those of the model file, which does not say where a game is played. */
  neutral: boolean | null;
}

/** One game with what each source says of it, whichever file it is read from. */
export interface CardGame {
  id: string;
  /** The scheduled start, in UTC. */
  commence_time: string;
  /** Three-letter team codes. */
  home: string;
  away: string;
  pointsRest: PointsRestForecast | null;
  /** Why there is no forecast of the points-and-rest model. Null when there is one. */
  missing: MissingPointsRest | null;
  /** Elo's chance for the home team. Null when it has none. */
  elo: number | null;
  /** Null when the page does not hold the ratings that the chance was worked out from. */
  eloInputs: EloInputs | null;
  /** The sportsbooks' consensus. Null without a line. */
  line: Consensus | null;
  /** When that line was taken, in UTC. Null without a line. */
  lineAt: string | null;
  /**
   * Where the line is from: the latest snapshot of the board, or the
   * forecasts file. That file holds the line the job had when it froze the
   * forecasts, which is normally the one of 21:10 the evening before.
   */
  lineFrom: 'snapshot' | 'morning';
  /**
   * The line of the first snapshot in which the job saw one for the game.
   * Null when no snapshot had one, and in the forecasts file, which does not
   * carry it.
   */
  open: OpeningLine | null;
  /** Whether the game is on a neutral floor. Only the forecasts file says, so it is null without it. */
  neutral: boolean | null;
}

/** The published files other than the board that a card can draw on. Each is null until the page has it. */
export interface FilesAtHand {
  model: ModelRatings | null;
  /** The forecasts of the day whose frozen forecasts the board carries. */
  predictions: DayPredictions | null;
}

function eloInputs(game: BoardGame, board: Board, frozen: PredictedGame | undefined, model: ModelRatings | null): EloInputs | null {
  if (game.elo === null) return null;

  // The forecasts file of the game's day holds the very numbers that its frozen chance was worked out from.
  if (frozen) {
    return {
      home: frozen.elo.home_rating,
      away: frozen.elo.away_rating,
      homeCourt: frozen.elo.home_court,
      neutral: frozen.neutral,
    };
  }

  // The model file is rebuilt once a day. Its ratings explain a chance on the board only when both are of the same daily run.
  if (model === null || board.models === null || model.results_through !== board.models.results_through) return null;
  const { ratings, constants } = model.elo;
  if (!hasRow(ratings, game.home) || !hasRow(ratings, game.away)) return null;
  return { home: ratings[game.home].rating, away: ratings[game.away].rating, homeCourt: constants.home_court, neutral: null };
}

/** A game on the board, with what the other files at hand add to it. */
export function boardGame(game: BoardGame, board: Board, files: FilesAtHand): CardGame {
  const frozen = files.predictions?.games.find((entry) => entry.id === game.id);
  return {
    id: game.id,
    commence_time: game.commence_time,
    home: game.home,
    away: game.away,
    pointsRest: game.points_rest,
    missing: missingPointsRest(game, board),
    elo: game.elo?.p_home ?? null,
    eloInputs: eloInputs(game, board, frozen, files.model),
    line: game.line,
    lineAt: game.line?.captured_at ?? null,
    lineFrom: 'snapshot',
    open: game.open,
    neutral: frozen ? frozen.neutral : null,
  };
}

/** A game of a forecasts file: the forecasts of its morning, and the line that the job held then. */
export function forecastGame(game: PredictedGame): CardGame {
  return {
    id: game.id,
    commence_time: game.commence_time,
    home: game.home,
    away: game.away,
    pointsRest: game.points_rest,
    // A forecasts file is without this model for a whole day, the day on which the results did not pass the checks.
    missing: game.points_rest === null ? 'left-out' : null,
    elo: game.elo.p_home,
    eloInputs: {
      home: game.elo.home_rating,
      away: game.elo.away_rating,
      homeCourt: game.elo.home_court,
      neutral: game.neutral,
    },
    line: game.market,
    lineAt: game.market?.at ?? null,
    lineFrom: 'morning',
    open: null,
    neutral: game.neutral,
  };
}

export interface CardTeam {
  /** The three-letter code. */
  code: string;
  /** The full name: "Detroit Pistons". */
  name: string;
  /** The team's chance by the source the card leads with, in whole percent. Null when no source has a number. */
  chance: number | null;
  /** Whether that source picks this team. */
  picked: boolean;
}

/** One source's line on a card. */
export interface SourceRow {
  source: SourceKey;
  /** The source's chance for the home team, which its bar is drawn from. Null when it has none. */
  pHome: number | null;
  /** `pick` when the source has a side at 52% or more, `toss-up` when it has a number and no pick, `missing` without a number. */
  kind: 'pick' | 'toss-up' | 'missing';
  /** At the end of the line: the pick with its chance, "Toss-up", or why there is no number. */
  label: string;
  /**
   * Next to the name when the number is not what a visitor would take it for:
   * the time of a line that is not the latest one, as in "as of Sat 9:10 PM",
   * or "not frozen" for a chance that is not a frozen forecast.
   */
  qualifier: string | null;
  /** A small line under the bar. Only the sportsbooks have one: how many they are and how far apart. */
  note: string | null;
}

/** What "How these numbers are made" says of one source. */
export interface MadeLine {
  source: SourceKey;
  /** The numbers that the source's chance comes from, in a sentence that the card sets off. Null when the page does not hold them. */
  figures: string | null;
  /** What is to be known of the chance, in a sentence or two. */
  text: string;
  /** Where the page does the sum of the figures for itself, with the words of the link. Null when it does not. */
  link: { href: string; label: string } | null;
}

type Made = Omit<MadeLine, 'source'>;

export type Chip = 'different-picks' | 'toss-up';

export interface GameCardView {
  id: string;
  /** The game in words, for the heading of its card: "Boston Celtics at Detroit Pistons". */
  title: string;
  /** The scheduled start, in UTC, as the files write it. */
  commenceTime: string;
  /** The start as the card writes it, in the visitor's time zone. */
  start: string;
  /** The day of the game, as display/day.ts counts it. */
  day: string;
  away: CardTeam;
  home: CardTeam;
  /** True on a neutral floor, where the second team is not at home. Null when the page cannot tell. */
  neutral: boolean | null;
  /** The one label in the corner of the card. */
  chip: Chip | null;
  /** The source of the two large chances. Null when no source has a number for the game. */
  headline: SourceKey | null;
  /** Says where the two large chances come from. */
  caption: string;
  /** The three sources, in the order of the page. */
  rows: SourceRow[];
  /** One sentence on how the models stand to the sportsbooks, when there is something to say. */
  note: string | null;
  /** Whether a model and the sportsbooks pick different sides. */
  differentPicks: boolean;
  /** Whether the card holds a forecast that was frozen on the morning of the game, which is the kind the job grades. */
  frozen: boolean;
  /** One entry for each source there is something to say of, in the order of the page. */
  made: MadeLine[];
}

const NAMES = { points_rest: source('points_rest').name, elo: source('elo').name, market: source('market').name };

const MARGIN_CAVEAT = 'This expected margin is a number to compare games by, not a point spread.';

function chanceOf(game: CardGame, key: SourceKey): number | null {
  switch (key) {
    case 'points_rest':
      return game.pointsRest?.p_home ?? null;
    case 'elo':
      return game.elo;
    case 'market':
      return game.line?.p_home ?? null;
  }
}

function codeOf(game: CardGame, side: Side): string {
  return side === 'home' ? game.home : game.away;
}

function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

/**
 * The source a card leads with: the first in the order of the page that has
 * a number for the game. That is the points-and-rest model once its
 * forecast is frozen, Elo before, and the sportsbooks when no model has
 * said anything.
 */
export function headlineOf(game: CardGame): SourceKey | null {
  return SOURCES.find((entry) => chanceOf(game, entry.key) !== null)?.key ?? null;
}

/** The models that pick the side the sportsbooks do not pick. A source without a pick differs from nobody. */
export function differingModels(game: CardGame): SourceKey[] {
  const market = chanceOf(game, 'market');
  return MODELS.map((model) => model.key).filter((key) => picksDiffer(chanceOf(game, key), market));
}

/** Where the two large chances come from, and why they are not from the model that would come first. */
export function headlineCaption(headline: SourceKey | null, missing: MissingPointsRest | null): string {
  switch (headline) {
    case 'points_rest':
      return `${NAMES.points_rest}, made this morning`;
    case 'elo':
      if (missing === 'not-yet') return `${NAMES.elo}, early look: the full forecast comes on the morning of the game`;
      if (missing === 'left-out') return `${NAMES.elo} alone: ${NAMES.points_rest} is left out today`;
      // The morning has come and nothing is frozen for the game. The number is what the ratings make of it, and the job grades frozen forecasts only.
      return `${NAMES.elo} from its current ratings: no forecast is frozen for this game, so the models are not graded on it`;
    case 'market':
      return missing === 'not-built'
        ? `${NAMES.market} alone: the models have not made a forecast yet`
        : `${NAMES.market} alone: the models have no forecast for this game`;
    case null:
      return 'No forecast and no line yet';
  }
}

/** What stands in place of a number, by source and by reason. */
function missingLabel(game: CardGame, key: SourceKey): string {
  if (key === 'market') {
    // The forecasts file says only that the job held no line when it froze the forecasts.
    if (game.lineFrom === 'morning') return 'No line that morning';
    // A game that had a line in an earlier snapshot has lost it, which is not the same as never having had one.
    return game.open === null ? 'No line yet' : 'No line right now';
  }
  if (key === 'elo') return game.missing === 'not-built' ? 'No forecast yet' : 'No forecast';
  switch (game.missing) {
    case 'not-yet':
      return 'Morning of the game';
    case 'left-out':
      return 'Left out today';
    case 'not-built':
      return 'No forecast yet';
    default:
      return 'No forecast';
  }
}

/**
 * The side that the sportsbooks' numbers are written for: their pick, or
 * the side they lean to in a toss-up, or the home team at exactly even.
 */
function lineSide(line: Consensus): Side {
  return pickedSide(line.p_home) ?? leaningSide(line.p_home) ?? 'home';
}

/** The lowest and the highest sportsbook for one side, in whole percent. */
function rangeFor(line: Consensus, side: Side): { low: number; high: number } {
  const low = wholePercent(line.lo);
  const high = wholePercent(line.hi);
  return side === 'home' ? { low, high } : { low: 100 - high, high: 100 - low };
}

/** How many sportsbooks are behind the line and how far apart they are, for the small line under their bar. */
export function sportsbooksNote(line: Consensus, home: string, away: string): string {
  if (line.n === 1) return '1 sportsbook';

  const side = lineSide(line);
  const { low, high } = rangeFor(line, side);
  return low === high
    ? `${line.n} sportsbooks within a point of each other`
    : `Median of ${line.n} sportsbooks, ${side === 'home' ? home : away} ${low}% to ${high}%`;
}

/**
 * A moment as "Sat 9:10 PM". The weekday tells the evening before from the
 * day itself without the page's clock. Without a time zone the visitor's own
 * is used.
 */
function weekdayAndTime(time: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(time));
}

/**
 * When the line of the card was taken, for a line from the forecasts file:
 * "as of Sat 9:10 PM". Such a line is hours older than the forecasts next to
 * it and is not the one the game is graded against. Null for the line of the
 * latest snapshot, whose time the status line gives.
 */
function lineDate(game: CardGame, timeZone?: string): string | null {
  return game.lineFrom === 'morning' && game.lineAt !== null ? `as of ${weekdayAndTime(game.lineAt, timeZone)}` : null;
}

function qualifierOf(game: CardGame, key: SourceKey, timeZone?: string): string | null {
  if (key === 'market') return lineDate(game, timeZone);
  // The morning of the game has come without a frozen forecast, so Elo's number is not one.
  return key === 'elo' && game.missing === 'none' ? 'not frozen' : null;
}

function sourceRow(game: CardGame, key: SourceKey, timeZone?: string): SourceRow {
  const pHome = chanceOf(game, key);
  if (pHome === null) {
    return { source: key, pHome, kind: 'missing', label: missingLabel(game, key), qualifier: null, note: null };
  }

  return {
    source: key,
    pHome,
    kind: pickedSide(pHome) === null ? 'toss-up' : 'pick',
    label: pickLabel(pHome, game),
    qualifier: qualifierOf(game, key, timeZone),
    note: key === 'market' && game.line ? sportsbooksNote(game.line, game.home, game.away) : null,
  };
}

/**
 * One sentence on how the models stand to the sportsbooks: who picks whom
 * when a model and the sportsbooks pick different sides, and otherwise how
 * far the model the card leads with is from the sportsbooks, from five
 * percentage points on. The points are those between the whole percents on
 * the card, and they are counted for the team the model picks, or for the
 * sportsbooks' pick when the model has none. Against a line from the
 * forecasts file the sentence says which line it is.
 */
export function comparison(game: CardGame, timeZone?: string): string | null {
  const market = chanceOf(game, 'market');
  const theirs = market === null ? null : pickedSide(market);
  const dated = lineDate(game, timeZone);
  const differing = differingModels(game);
  if (theirs !== null && differing.length > 0) {
    const models = listed(differing.map((key) => NAMES[key]));
    const verb = differing.length === 1 ? 'picks' : 'pick';
    const favorite = nameInSentence(codeOf(game, theirs));
    const sportsbooks = dated === null ? `the sportsbooks pick ${favorite}` : `the sportsbooks picked ${favorite} ${dated}`;
    return `${models} ${verb} ${nameInSentence(codeOf(game, otherSide(theirs)))}, ${sportsbooks}.`;
  }

  const headline = headlineOf(game);
  const model = headline === null || headline === 'market' ? null : chanceOf(game, headline);
  if (headline === null || model === null || market === null) return null;

  // Two sources that are five points apart cannot both be toss-ups, so one of them has a pick.
  const side = pickedSide(model) ?? theirs;
  if (side === null) return null;
  const apart = chances(model)[side] - chances(market)[side];
  if (Math.abs(apart) < 5) return null;
  const team = nameInSentence(codeOf(game, side));
  const sportsbooks = dated === null ? 'the sportsbooks' : `the sportsbooks were ${dated}`;
  // The margin of the same model is in points of the game, so these are called what they are.
  return `${NAMES[headline]} is ${Math.abs(apart)} percentage points ${apart > 0 ? 'higher' : 'lower'} on ${team} than ${sportsbooks}.`;
}

/**
 * The expected margin of the points-and-rest model as an addition of its
 * three parts, written for the team it expects to win: "Detroit by 5.1 =
 * ratings +3.98, home court +1.16, rest 0.00". The files give every part in
 * points for the home team, so the signs turn around for the away team.
 */
export function marginSum(forecast: PointsRestForecast, home: string, away: string): string {
  const by = signedPoints(Math.abs(forecast.margin), 1).replace('+', '');
  const level = Number(by) === 0;
  const ahead: Side = level || forecast.margin > 0 ? 'home' : 'away';
  const turn = ahead === 'home' ? 1 : -1;
  const parts = [
    `ratings ${signedPoints(turn * forecast.rating_edge, 2)}`,
    `home court ${signedPoints(turn * forecast.home_court, 2)}`,
    `rest ${signedPoints(turn * forecast.rest_edge, 2)}`,
  ].join(', ');

  return level
    ? `Level on points: for ${nameInSentence(home)}, ${parts}.`
    : `${shortName(ahead === 'home' ? home : away)} by ${by} = ${parts}.`;
}

function pointsRestMade(game: CardGame): Made {
  if (game.pointsRest) return { figures: marginSum(game.pointsRest, game.home, game.away), text: MARGIN_CAVEAT, link: null };
  switch (game.missing) {
    case 'not-yet':
      return {
        figures: null,
        text: 'Made on the morning of the game and not before: it counts rest, and only then is it known who played the evening before.',
        link: null,
      };
    case 'left-out':
      return { figures: null, text: "Left out today, because the results on record did not pass this morning's checks.", link: null };
    default:
      return { figures: null, text: 'No forecast of this model was frozen for the game on the morning of its day.', link: null };
  }
}

function eloMade(game: CardGame): Made | null {
  if (game.elo === null || game.eloInputs === null) return null;

  const { home, away, homeCourt, neutral } = game.eloInputs;
  const homeTeam = nameInSentence(game.home);
  const sentences: string[] = [];
  if (neutral === true) sentences.push('On a neutral floor home court adds nothing.');
  else if (neutral === false) sentences.push(`Home court adds ${homeCourt} rating points for ${homeTeam}.`);
  // The model file does not say where a game is played, and the page does not guess it.
  else sentences.push(`Home court adds ${homeCourt} rating points for ${homeTeam}, unless the floor is neutral.`);

  // The chance of a later game follows the ratings of each daily run until its own morning.
  if (game.missing === 'not-yet') sentences.push('This early look can still move until the morning of the game.');
  // pipeline/README.md: without a frozen forecast the board's chance is what the ratings of the last daily run make of the game.
  if (game.missing === 'none') {
    sentences.push('This chance is what the ratings of the last daily run make of the game. It is not a frozen forecast, and the models are graded on frozen forecasts only.');
  }

  return {
    figures: `Ratings: ${shortName(game.away)} ${away}, ${shortName(game.home)} ${home}.`,
    text: sentences.join(' '),
    // The calculator of the Rankings view does this sum with the home court added. On a neutral floor that is another sum.
    link:
      neutral === true
        ? null
        : { href: hrefOf('rankings', matchupParam({ away: game.away, home: game.home })), label: 'See the sum in the matchup calculator' },
  };
}

/** A date as "Oct 10". Without a time zone the visitor's own is used. */
function monthAndDay(time: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(new Date(time));
}

/**
 * The first line the files hold for a game, in a sentence. It is the line of
 * the first snapshot in which the job saw one, which is not when the
 * sportsbooks first quoted the game: every game they quoted before the job's
 * first snapshot has that snapshot's time.
 */
function firstLine(game: CardGame, open: OpeningLine, side: Side, timeZone?: string): string {
  const team = nameInSentence(codeOf(game, side));
  return `The first line recorded here, on ${monthAndDay(open.at, timeZone)}, had ${team} at ${chances(open.p_home)[side]}%.`;
}

/** What is to be said of a game without a line, which depends on whether it ever had one. */
function noLine(game: CardGame, timeZone?: string): string {
  if (game.lineFrom === 'morning') return 'The job held no line for this game when it froze the forecasts of the day.';
  const { open } = game;
  if (open === null) return 'No line has been recorded for this game yet.';

  const side = pickedSide(open.p_home) ?? leaningSide(open.p_home) ?? 'home';
  return `No sportsbook quoted both teams in the latest snapshot. ${firstLine(game, open, side, timeZone)}`;
}

function sportsbooksMade(game: CardGame, timeZone?: string): string {
  const { line, open } = game;
  if (line === null) return noLine(game, timeZone);

  const side = lineSide(line);
  const team = nameInSentence(codeOf(game, side));
  const sentences: string[] = [];
  if (line.n === 1) {
    sentences.push('One sportsbook quotes this game. The number is what its prices imply, with its margin taken out.');
  } else {
    const { low, high } = rangeFor(line, side);
    sentences.push(`The median of what ${line.n} sportsbooks imply, with their margin taken out.`);
    sentences.push(low === high ? 'They are within a point of each other.' : `They run from ${low}% to ${high}% for ${team}.`);
  }
  const dated = lineDate(game, timeZone);
  if (dated !== null) sentences.push(`It is the line ${dated}, which the job held when it froze the forecasts of the day.`);
  if (open) sentences.push(firstLine(game, open, side, timeZone));
  return sentences.join(' ');
}

/** "How these numbers are made": what there is to say of each source for one game, in the order of the page. */
export function madeLines(game: CardGame, timeZone?: string): MadeLine[] {
  const elo = eloMade(game);
  return [
    // With no model built there is nothing to say of the points-and-rest model that the card does not say already.
    ...(game.missing === 'not-built' ? [] : [{ source: 'points_rest' as const, ...pointsRestMade(game) }]),
    ...(elo === null ? [] : [{ source: 'elo' as const, ...elo }]),
    { source: 'market' as const, figures: null, text: sportsbooksMade(game, timeZone), link: null },
  ];
}

/** The calendar date of a moment in a time zone, written as a day: 2026-11-08. */
function dateIn(time: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(time);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The start of a game as its card writes it. The cards of a day stand under
 * the name of that day, so the time of day is enough: "7:10 PM EST". For a
 * visitor in whose time zone the game starts on another date, the date is
 * written as well.
 */
export function startLabel(commenceTime: string, timeZone?: string): string {
  const start = new Date(commenceTime);
  return dateIn(start, timeZone) === gameDay(commenceTime) ? formatTime(start, timeZone) : formatDate(start, timeZone);
}

function cardTeam(game: CardGame, side: Side, pHome: number | null): CardTeam {
  const code = codeOf(game, side);
  return {
    code,
    name: teamName(code),
    chance: pHome === null ? null : chances(pHome)[side],
    picked: pHome !== null && pickedSide(pHome) === side,
  };
}

/** The card of one game. Without a time zone the visitor's own is used for the start and for the dates in the text. */
export function gameCardView(game: CardGame, timeZone?: string): GameCardView {
  const headline = headlineOf(game);
  const leading = headline === null ? null : chanceOf(game, headline);
  const differentPicks = differingModels(game).length > 0;
  const tossUp = leading !== null && pickedSide(leading) === null;

  const away = teamName(game.away);
  const home = teamName(game.home);

  return {
    id: game.id,
    // On a neutral floor neither team is at the other's.
    title: game.neutral === true ? `${away} against ${home}, on a neutral floor` : `${away} at ${home}`,
    commenceTime: game.commence_time,
    start: startLabel(game.commence_time, timeZone),
    day: gameDay(game.commence_time),
    away: cardTeam(game, 'away', leading),
    home: cardTeam(game, 'home', leading),
    neutral: game.neutral,
    chip: differentPicks ? 'different-picks' : tossUp ? 'toss-up' : null,
    headline,
    caption: headlineCaption(headline, game.missing),
    rows: SOURCES.map((entry) => sourceRow(game, entry.key, timeZone)),
    note: comparison(game, timeZone),
    differentPicks,
    // On a day on which one model is left out, Elo's forecast is frozen all the same.
    frozen: game.pointsRest !== null || (game.elo !== null && game.missing === 'left-out'),
    made: madeLines(game, timeZone),
  };
}

/** The words of a chip. */
export function chipLabel(chip: Chip): string {
  return chip === 'different-picks' ? 'Different picks' : TOSS_UP;
}
