/**
 * One game that is over, as the results view shows it: the two teams with
 * the final score, what each source had said and what became of it, up to
 * two chips, and the details that its result line holds. Every verdict is
 * the job's, from the line. Nothing here grades a forecast.
 */
import type { MarketLine } from '../data/forecasts';
import type { ResultLine, Verdict } from '../data/results';
import { signedPoints } from './numbers';
import { favorite, leaningSide, onePlaceChance, pickedSide, pickLabel, picksDiffer, tenThousandths, TOSS_UP, type Side } from './pick';
import { resultChance, resultVerdict, source, SOURCES, type SourceKey } from './sources';
import { nameInSentence, shortName, teamName } from './teams';
import { publishedTooLate, winningSide } from './verdict';

type Model = 'points_rest' | 'elo';

/** One team of a game that is over. */
export interface TeamScore {
  /** The three-letter code. */
  code: string;
  /** The full name. */
  name: string;
  points: number;
  won: boolean;
}

/**
 * Why a source has nothing that could be graded for a game.
 * - `no-line`: no line of the sportsbooks was recorded from before the start.
 * - `left-out`: the points-and-rest model was left out on the day of the
 *   game. The line then holds Elo's forecast and not this model's.
 * - `no-forecast`: the forecasts of the game's day were not made, or were
 *   made without this game.
 */
export type Missing = 'no-line' | 'left-out' | 'no-forecast';

/** What one source had said of a game, and what became of it. */
export interface SourceCell {
  source: SourceKey;
  /** What it said, as a card writes it: "DET 57%", or "Toss-up". Null when it said nothing, which a card shows as a dash. */
  said: string | null;
  /** The job's verdict. */
  verdict: Verdict;
  /** True for a forecast that was published at or after the start, which does not count. */
  tooLate: boolean;
  /** A few words for what the mark does not say: why there is nothing to grade, or that the forecast came too late. */
  note: string | null;
}

/** A word that sets a game apart, with the sentence that goes with it. */
export interface Chip {
  kind: 'upset' | 'split';
  /** The word on the chip. */
  label: string;
  text: string;
}

/**
 * One line of the details: a name, and what the file holds under it. A time
 * is given as the file writes it, for the page to show in the visitor's zone.
 */
export type Fact = { term: string; text: string } | { term: string; time: string };

/** What the result line holds of one source. */
export interface SourceDetails {
  source: SourceKey;
  facts: Fact[];
  /** A sentence for each thing that the facts do not say by themselves. */
  notes: string[];
}

export interface GameDetails {
  /** When the game started and when its result was recorded. */
  game: Fact[];
  /** One for each source, in the order of the page. */
  sources: SourceDetails[];
}

export interface GameRow {
  id: string;
  away: TeamScore;
  home: TeamScore;
  /** One for each source, in the order of the page. */
  cells: SourceCell[];
  /** At most two. */
  chips: Chip[];
  details: GameDetails;
}

type Teams = Pick<ResultLine, 'home' | 'away'>;

function teamOn(side: Side, teams: Teams): string {
  return side === 'home' ? teams.home : teams.away;
}

/** Null when the line holds what the source said. */
export function missingOf(line: ResultLine, key: SourceKey): Missing | null {
  if (line[key] !== null) return null;
  if (key === 'market') return 'no-line';
  // The forecasts of a day hold Elo's for every game. A game with Elo's alone is of a day on which the other model was left out.
  return key === 'points_rest' && line.elo !== null ? 'left-out' : 'no-forecast';
}

const MISSING_NOTES: Record<Missing, string> = {
  'no-line': 'No line before the start',
  'left-out': 'Left out that day',
  'no-forecast': 'No forecast for this game',
};

export function sourceCell(line: ResultLine, key: SourceKey): SourceCell {
  const chance = resultChance(line, key);
  const missing = missingOf(line, key);
  const tooLate = key !== 'market' && publishedTooLate(line, key);
  const lateNote = tooLate ? 'Published too late to count' : null;

  return {
    source: key,
    said: chance === null ? null : pickLabel(chance, line),
    verdict: resultVerdict(line, key),
    tooLate,
    note: missing === null ? lateNote : MISSING_NOTES[missing],
  };
}

/** The team that a chance for the home team picks, as a sentence names it. Null for a toss-up. */
function pickedTeam(pHome: number, teams: Teams): string | null {
  const side = pickedSide(pHome);
  return side && nameInSentence(teamOn(side, teams));
}

/** The sportsbooks' favorite lost. The chip says how sure they had been of it. */
function upsetChip(line: ResultLine): Chip | null {
  if (line.market === null || line.market_verdict !== 'upset') return null;
  const lost = favorite(line.market.p_home);
  if (lost === null) return null;
  return {
    kind: 'upset',
    label: 'Upset',
    text: `${source('market').name} had ${nameInSentence(teamOn(lost.side, line))} at ${lost.chance}%`,
  };
}

/** The two models picked different sides. A forecast that came too late is not a pick that counts. */
function splitChip(line: ResultLine): Chip | null {
  const { points_rest, elo } = line;
  if (points_rest === null || elo === null) return null;
  if (publishedTooLate(line, 'points_rest') || publishedTooLate(line, 'elo')) return null;
  if (!picksDiffer(points_rest.p_home, elo.p_home)) return null;
  return {
    kind: 'split',
    label: 'Models split',
    text: `${source('points_rest').name} had ${pickedTeam(points_rest.p_home, line)}, ${source('elo').name} had ${pickedTeam(elo.p_home, line)}`,
  };
}

/** The chips of a game, of which there are two at most: the upset first. */
export function chipsOf(line: ResultLine): Chip[] {
  return [upsetChip(line), splitChip(line)].filter((chip) => chip !== null);
}

/**
 * A chance for the home team as the details write it: the side it leans to,
 * by its short name, with that side's chance. A chance that picks neither
 * side is called a toss-up.
 */
export function chanceWords(pHome: number, teams: Teams): string {
  const side = leaningSide(pHome);
  if (side === null) return `${TOSS_UP}, 50.0% each`;

  const leaning = `${shortName(teamOn(side, teams))} ${onePlaceChance(side === 'home' ? pHome : 1 - pHome)}`;
  return pickedSide(pHome) === null ? `${TOSS_UP}, ${leaning}` : leaning;
}

/** A sentence on how many sportsbooks a line is the median of, and how far apart they were. */
export function sportsbooksWords(market: MarketLine, teams: Teams): string {
  if (market.n === 1) return 'The line is from 1 sportsbook.';

  if (tenThousandths(market.lo) === tenThousandths(market.hi)) return `All ${market.n} sportsbooks had the same chance.`;

  // The range is that of the side the line leans to, and of the home team at exactly even.
  const away = leaningSide(market.p_home) === 'away';
  const [low, high] = away ? [1 - market.hi, 1 - market.lo] : [market.lo, market.hi];
  const team = nameInSentence(away ? teams.away : teams.home);
  return `It is the median of ${market.n} sportsbooks, which had ${team} from ${onePlaceChance(low)} to ${onePlaceChance(high)}.`;
}

/**
 * A margin for the home team in words: "Atlanta by 3.5 points", and "Even"
 * for a margin that rounds to nothing.
 */
export function marginWords(margin: number, teams: Teams, decimals: 0 | 1): string {
  const written = signedPoints(margin, decimals);
  const ahead = written.startsWith('+') ? 'home' : written.startsWith('−') ? 'away' : null;
  if (ahead === null) return 'Even';

  const by = written.slice(1);
  return `${shortName(teamOn(ahead, teams))} by ${by} ${by === '1' ? 'point' : 'points'}`;
}

const NO_PICK = 'Neither team was at 52%, so there was no pick to grade.';
const TOO_LATE = 'It was published at or after the start of the game, so it does not count.';
// pipeline/model/README.md: the expected margin is on a scale where a blowout counts as 22 points.
const MARGIN_SCALE = `${source('points_rest').name} counts a blowout as 22 points, so a real margin can be much larger than an expected one. The expected margin is a number to compare games by.`;

const MISSING_SENTENCES: Record<Missing, string> = {
  'no-line': 'No line was recorded for this game from before its start, so the sportsbooks are not graded on it.',
  'left-out': `${source('points_rest').name} was left out that day: the results it is built from did not pass the checks of that morning.`,
  'no-forecast': 'There is no forecast for this game: the forecasts of its day were not made, or were made without it.',
};

/** The line that the game was graded against, and when it was taken. */
function marketDetails(line: ResultLine): SourceDetails {
  const { market } = line;
  if (market === null) return { source: 'market', facts: [], notes: [MISSING_SENTENCES['no-line']] };

  return {
    source: 'market',
    facts: [
      { term: 'Line', text: chanceWords(market.p_home, line) },
      { term: 'Taken', time: market.at },
    ],
    notes: [sportsbooksWords(market, line), ...(line.market_verdict === 'toss_up' ? [NO_PICK] : [])],
  };
}

/** What a model said and when it was published, and for the points-and-rest model its expected margin next to the real one. */
function modelDetails(line: ResultLine, key: Model): SourceDetails {
  const forecast = line[key];
  if (forecast === null) return { source: key, facts: [], notes: [MISSING_SENTENCES[missingOf(line, key) ?? 'no-forecast']] };

  const facts: Fact[] = [{ term: 'Chance', text: chanceWords(forecast.p_home, line) }];
  const notes: string[] = [];
  if (publishedTooLate(line, key)) notes.push(TOO_LATE);
  else if (resultVerdict(line, key) === 'toss_up') notes.push(NO_PICK);

  if (key === 'points_rest' && line.points_rest !== null) {
    facts.push(
      { term: 'Expected margin', text: marginWords(line.points_rest.margin, line, 1) },
      { term: 'Final margin', text: marginWords(line.home_pts - line.away_pts, line, 0) },
    );
    notes.push(MARGIN_SCALE);
  }
  facts.push({ term: 'Published', time: forecast.published_at });
  return { source: key, facts, notes };
}

/** What the result line holds, and nothing else. */
export function gameDetails(line: ResultLine): GameDetails {
  return {
    game: [
      { term: 'Started', time: line.commence_time },
      { term: 'Result recorded', time: line.recorded_at },
    ],
    sources: SOURCES.map(({ key }) => (key === 'market' ? marketDetails(line) : modelDetails(line, key))),
  };
}

export function gameRow(line: ResultLine): GameRow {
  const winner = winningSide(line);
  const team = (side: Side, points: number): TeamScore => {
    const code = teamOn(side, line);
    return { code, name: teamName(code), points, won: winner === side };
  };

  return {
    id: line.id,
    away: team('away', line.away_pts),
    home: team('home', line.home_pts),
    cells: SOURCES.map(({ key }) => sourceCell(line, key)),
    chips: chipsOf(line),
    details: gameDetails(line),
  };
}
