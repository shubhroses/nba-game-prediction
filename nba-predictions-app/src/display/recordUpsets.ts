/**
 * The biggest upsets of each source: the picks that lost, the one that was
 * given the highest chance first. The record lists up to three for a source.
 */
import type { Scorecard, SeasonRecord, Upset } from '../data/record';
import { onePlaceChance } from './pick';
import { recordedDay, sourceCards } from './record';
import type { Source } from './sources';
import { teamName } from './teams';

export interface UpsetRow {
  id: string;
  /** The code of the team that was picked and lost. */
  favorite: string;
  /** The chance it was given, to one decimal: "87.9%". */
  chance: string;
  /** What became of it, with its own points first: "Lost 104–109 to the Chicago Bulls". */
  outcome: string;
  /** The game as the schedule calls it, the home team last, and its day: "CHI at MIA, Thu, Nov 5". */
  game: string;
}

export interface SourceUpsets {
  source: Source;
  rows: UpsetRow[];
  /** What stands in for the list while it is empty. Null when it is not. */
  none: string | null;
}

function upsetRow(upset: Upset): UpsetRow {
  const atHome = upset.favorite === upset.home;
  const [own, other] = atHome ? [upset.home_pts, upset.away_pts] : [upset.away_pts, upset.home_pts];
  return {
    id: upset.id,
    favorite: upset.favorite,
    chance: onePlaceChance(upset.p_favorite),
    outcome: `Lost ${own}–${other} to the ${teamName(atHome ? upset.away : upset.home)}`,
    game: `${upset.away} at ${upset.home}, ${recordedDay(upset)}`,
  };
}

/** A source in the middle of a sentence. The sportsbooks are many, and the two models go by their names. */
function inSentence(source: Source): string {
  return source.key === 'market' ? 'the sportsbooks' : source.name;
}

function none(source: Source, card: Scorecard): string | null {
  if (card.biggest_upsets.length > 0) return null;
  const whose = inSentence(source);
  return card.games === 0 ? `No pick of ${whose} has been graded yet.` : `No pick of ${whose} has lost yet.`;
}

/** The upsets of each source that the record has, in the order of the page. */
export function biggestUpsets(record: SeasonRecord): SourceUpsets[] {
  return sourceCards(record).map(({ source, card }) => ({
    source,
    rows: card.biggest_upsets.map(upsetRow),
    none: none(source, card),
  }));
}
