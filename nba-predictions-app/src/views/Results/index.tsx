import { useMemo, type ReactNode } from 'react';
import { DayPager, DayRail, EmptyState, Notice, SectionTitle, TextLink, ViewHeader, type PagerDay } from '../../components/ui';
import { dayName, pageDay } from '../../display/day';
import { countOf } from '../../display/numbers';
import {
  ALL_DAYS,
  dayHeading,
  dayTabs,
  emptyResults,
  neighbors,
  nextResults,
  resultDays,
  selection,
  type DayTab,
  type ResultDay,
} from '../../display/results';
import { hrefOf } from '../../display/route';
import { useDayRail } from '../../hooks/useDayRail';
import { classes } from '../../utils/classes';
import { formatDate } from '../../utils/formatters';
import type { ViewProps } from '../types';
import Counts from './Counts';
import GameList from './GameList';
import Tiles from './Tiles';

interface DayProps {
  day: ResultDay;
  /** The day by the page's clock. */
  today: string;
  /** True for the day that the view opens with, which has a tile for each source. */
  opening: boolean;
  refreshing: boolean;
}

/** The results of one day: its title, how each source did, and its games. */
function Day({ day, today, opening, refreshing }: DayProps) {
  const { title, aside } = dayHeading(day, today);

  return (
    <section aria-label={`Results of ${dayName(day.day)}`}>
      {/* The title stays under the tabs while the games of its day pass, so that a long list says which day it
          shows. Its bar is 44px high: the heads of the columns stay under it on a wide screen. */}
      <div className="sticky top-tabs z-10 -mx-gutter mb-1 min-h-11 bg-page px-gutter py-2">
        <SectionTitle aside={aside} flush>
          {title}
        </SectionTitle>
      </div>
      {opening ? (
        <Tiles tallies={day.tallies} />
      ) : (
        <p className="mb-3 text-sm text-muted">
          <Counts tallies={day.tallies} />
        </p>
      )}
      {day.cutAt !== null && (
        <p className="mb-3 text-sm text-muted">
          This view keeps a result for eight days, so a game of this day that started before{' '}
          <time dateTime={new Date(day.cutAt).toISOString()}>{formatDate(new Date(day.cutAt))}</time> is no longer in it. The
          record counts every game.
        </p>
      )}
      <GameList games={day.games} refreshing={refreshing} />
    </section>
  );
}

/** A day of the view as the rail and the links at the end of a day show it. */
function railDay(tab: DayTab) {
  return { key: tab.key, label: tab.label, note: countOf(tab.games, 'game'), href: tab.href };
}

function pagerDay(tab: DayTab | null): PagerDay | null {
  return tab && railDay(tab);
}

interface OnwardProps {
  /** Leads to the games to come as well, for the view without a result. */
  games?: boolean;
  /** Leads back to every day, under one day that is shown alone. */
  allDays?: boolean;
  /** False under the links to the day before and the day after, which have a line above them already. */
  ruled?: boolean;
  children?: ReactNode;
}

/** The way on from the view, at its end: to the record, and where it helps to every day or to the games to come. */
function Onward({ games = false, allDays = false, ruled = true, children }: OnwardProps) {
  return (
    <div className={classes('text-sm text-muted', ruled ? 'mt-8 border-t border-line pt-4' : 'mt-5')}>
      {children}
      <p className="flex flex-wrap gap-x-6">
        {allDays && (
          <TextLink href={hrefOf('results')} standalone>
            See all days
          </TextLink>
        )}
        {games && (
          <TextLink href={hrefOf('games')} standalone>
            See the games to come
          </TextLink>
        )}
        <TextLink href={hrefOf('record')} standalone>
          See the full record
        </TextLink>
      </p>
    </div>
  );
}

/** The games that are over, by day, with what each source had said of them and whether its pick won. */
export default function Results({ board, now, refreshing, param }: ViewProps) {
  const days = useMemo(() => resultDays(board), [board]);
  const today = pageDay(board, now);
  const { day, problem } = selection(param, days);
  // After a change of day the results are read from the rail on.
  const rail = useDayRail(day);

  const header = (
    <ViewHeader title="Results">
      What each source said of the games of the last eight days, and whether its pick won. A pick is the side that a source put
      at 52% or more.
    </ViewHeader>
  );

  if (days.length === 0) {
    const { title, text } = emptyResults(board, now);
    return (
      <>
        {header}
        <EmptyState title={title}>{text}</EmptyState>
        <Onward games />
      </>
    );
  }

  const shown = day === null ? days : days.filter((entry) => entry.day === day);
  // What comes next is said where the newest results are in sight.
  const next = day === null || day === days[0].day ? nextResults(board, now) : null;
  const tabs = dayTabs(days, today);
  const { earlier, later } = day === null ? { earlier: null, later: null } : neighbors(days, day, today);

  return (
    <>
      {header}
      {/* The rail is what the page is scrolled to after a change of day, and it comes to rest under the tabs. */}
      <div ref={rail} tabIndex={-1} className="mb-5 outline-none">
        <DayRail days={tabs.map((tab) => ({ ...railDay(tab), selected: tab.key === (day ?? ALL_DAYS) }))} />
      </div>
      {problem && <Notice className="mb-5">{problem}</Notice>}
      {next && <p className="mb-5 text-sm text-muted">{next}</p>}

      <div className="space-y-8 sm:space-y-10">
        {shown.map((entry, index) => (
          <Day key={entry.day} day={entry} today={today} opening={index === 0} refreshing={refreshing} />
        ))}
      </div>
      <DayPager before={pagerDay(earlier)} after={pagerDay(later)} />

      <Onward allDays={day !== null} ruled={earlier === null && later === null}>
        <p>One night is a handful of games and says little about a source. The record counts every game of the season.</p>
      </Onward>
    </>
  );
}
