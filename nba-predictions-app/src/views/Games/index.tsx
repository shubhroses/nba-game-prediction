import { useMemo, useState } from 'react';
import GameList from '../../components/GameList';
import { DayPager, DayRail, EmptyState, FileStatus, Notice, SectionTitle, TextLink, ViewHeader, type PagerDay } from '../../components/ui';
import { pageDay } from '../../display/day';
import {
  filteredOut,
  gamesView,
  neighbors,
  NO_FILTERS,
  shownOf,
  startedNote,
  unlistedNote,
  type DayChip,
  type FilteredOut,
  type Filters,
} from '../../display/games';
import { gamesIntro, NO_RECORD_YET, recordTiles } from '../../display/gamesIntro';
import { countOf } from '../../display/numbers';
import { hrefOf } from '../../display/route';
import { useDayRail } from '../../hooks/useDayRail';
import { useModel } from '../../hooks/useModel';
import { useMyTeams } from '../../hooks/useMyTeams';
import { usePredictions } from '../../hooks/usePredictions';
import { classes } from '../../utils/classes';
import type { ViewProps } from '../types';
import FilterButtons from './FilterButtons';
import RecordStrip from './RecordStrip';

/**
 * A day of the view as the rail and the links at the foot of a day show it.
 * `unknown` stands in place of the count for a day whose games the page does
 * not know yet.
 */
function railDay(chip: DayChip, unknown: string | null) {
  return {
    key: chip.day,
    label: chip.label,
    note: unknown ?? countOf(chip.games, 'game'),
    href: hrefOf('games', chip.day),
    selected: chip.selected,
    // A day on which the filters keep no game is set back.
    quiet: unknown === null && chip.games === 0,
  };
}

/**
 * The games that are still to come, a day at a time. Every card leads with
 * the chance that the page's own models give, with the sportsbooks' number
 * beside it as the yardstick. Under the games of the current day stand the
 * ones that have started and have no result yet.
 */
export default function Games({ board, now, refreshing, param }: ViewProps) {
  // Elo's ratings, for "How these numbers are made". A card leaves that line out while the file is not here.
  const model = useModel(board);
  // The forecasts of the day that the board carries hold the games of that day that have left the board.
  const predictions = usePredictions(board, board.models?.predictions_day ?? null);
  const { teams, toggle, kept } = useMyTeams();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const modelFile = model.status === 'ready' ? model.data : null;
  const predictionsFile = predictions.status === 'ready' ? predictions.data : null;
  const view = useMemo(
    () => gamesView({ board, now, param, files: { model: modelFile, predictions: predictionsFile }, myTeams: teams, filters }),
    [board, now, param, modelFile, predictionsFile, teams, filters],
  );

  // After a change of day the games are read from the rail on.
  const rail = useDayRail(view.selected);

  const today = pageDay(board, now);
  const intro = gamesIntro(board, now);
  const tiles = recordTiles(board);
  const shown = view.upcoming.length + view.started.length + view.unlisted.length;
  const hidden = filteredOut(view);
  const filtering = view.applied.myTeams || view.applied.differentPicks;
  const { previous, next } = neighbors(view.days);

  // Late in the evening the board may list no game of the current day any more. Its games are then in the forecasts
  // file alone, and until that file is here the page does not say how many they are.
  const awaited = view.awaitingStarted ? (predictions.status === 'loading' ? 'Loading' : 'Not loaded') : null;
  const asRailDay = (chip: DayChip) => railDay(chip, chip.day === today && chip.games === 0 ? awaited : null);
  const asPagerDay = (chip: DayChip | null): PagerDay | null => chip && asRailDay(chip);

  return (
    <>
      {/* On a wide screen the record stands next to the introduction, and the games begin higher up. On a phone
          the first screen belongs to the games: the introduction and the record stand under them there. */}
      <div className="lg:flex lg:items-start lg:gap-10">
        <div className="min-w-0 lg:flex-1">
          {/* Before a pick has been graded, a sentence says when the first one will be. */}
          <ViewHeader title="Games" note={tiles.length === 0 ? NO_RECORD_YET : undefined} wideOnly>
            {intro.sentences.join(' ')}
          </ViewHeader>
          {intro.leftOut && (
            <Notice tone="warn" title={intro.leftOut.title} className="mb-5 sm:mb-6">
              {intro.leftOut.text} <TextLink href={hrefOf('rankings')}>Rankings</TextLink> lists what the checks found.
            </Notice>
          )}
        </div>
        {tiles.length > 0 && <RecordStrip tiles={tiles} className="mb-6 hidden sm:block lg:mt-1 lg:shrink-0" />}
      </div>

      {view.selected === null ? (
        <EmptyState title="No games are coming up right now">Check back after the next update.</EmptyState>
      ) : (
        <>
          {/* The rail is what the page is scrolled to after a change of day, and it comes to rest under the tabs. */}
          <div
            ref={rail}
            tabIndex={-1}
            className="mb-5 flex flex-col gap-3 outline-none md:flex-row md:items-start md:justify-between md:gap-6"
          >
            <DayRail days={view.days.map(asRailDay)} />
            <FilterButtons
              offered={view.offered}
              applied={view.applied}
              onToggle={(filter) => setFilters((chosen) => ({ ...chosen, [filter]: !chosen[filter] }))}
            />
          </div>

          {!kept && teams.size > 0 && (
            <p className="mb-4 text-xs text-muted">
              This browser did not store your teams, so they are kept only until the page is closed.
            </p>
          )}

          <section>
            {/* On a phone the selected day of the rail is heading enough, and the games begin higher up. */}
            <div className="sr-only md:not-sr-only">
              <SectionTitle aside={view.total > 0 ? shownOf(shown, view.total) : undefined}>{view.heading}</SectionTitle>
            </div>

            {hidden && <FilteredOutNotice hidden={hidden} onClear={() => setFilters(NO_FILTERS)} />}

            {view.upcoming.length > 0 && (
              <GameList cards={view.upcoming} kind="upcoming" myTeams={teams} onToggleTeam={toggle} refreshing={refreshing} />
            )}

            {view.upcoming.length === 0 && view.started.length > 0 && !filtering && (
              <p className="text-sm text-muted">Every game of the day has started.</p>
            )}
          </section>

          {view.started.length > 0 && (
            <section className="mt-8 sm:mt-10">
              <SectionTitle aside={countOf(view.started.length, 'game')} note={startedNote(view.started, today)}>
                Started
              </SectionTitle>
              <GameList cards={view.started} kind="started" myTeams={teams} onToggleTeam={toggle} refreshing={refreshing} />
            </section>
          )}

          {view.unlisted.length > 0 && (
            <section className="mt-8 sm:mt-10">
              <SectionTitle aside={countOf(view.unlisted.length, 'game')} note={unlistedNote(today, view.unlisted.length)}>
                Not in the latest snapshot
              </SectionTitle>
              <GameList cards={view.unlisted} kind="unlisted" myTeams={teams} onToggleTeam={toggle} refreshing={refreshing} />
            </section>
          )}

          {/* The forecasts file of the current day is what holds its started games that have left the board. While it
              loads, a spinner stands where they will be. When it cannot be loaded, the page says so on whichever day
              is shown, because nothing else on the page tells that games are missing from it. */}
          {view.awaitingStarted && (view.selected === today || predictions.status !== 'loading') && (
            <div className="mt-8 sm:mt-10">
              <FileStatus state={predictions} what="The forecasts of this morning" missing={null} />
            </div>
          )}

          <DayPager before={asPagerDay(previous)} after={asPagerDay(next)} />
        </>
      )}

      {/* What stands above the games on a wider screen, for a phone: what the forecasts rest on, and the record. */}
      <div className="mt-8 sm:hidden">
        <p className="text-sm text-muted">{intro.sentences.join(' ')}</p>
        {tiles.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted">{NO_RECORD_YET}</p>
        ) : (
          <RecordStrip tiles={tiles} className="mt-4 block" />
        )}
      </div>
    </>
  );
}

interface FilteredOutNoticeProps {
  hidden: FilteredOut;
  /** Switches the filters off. */
  onClear: () => void;
}

const ACTION = classes(
  'flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink',
  'hover:bg-sunken motion-safe:transition-colors',
);

/**
 * Stands in place of the games of a day when the filters hide every one of
 * them: it says which filter, leads to the nearest day on which the filters
 * keep a game, and offers to show the hidden ones.
 */
function FilteredOutNotice({ hidden, onClear }: FilteredOutNoticeProps) {
  return (
    <EmptyState title={hidden.title}>
      {hidden.text}
      <span className="mt-4 flex flex-wrap justify-center gap-2">
        {hidden.elsewhere && (
          <a href={hrefOf('games', hidden.elsewhere.day)} className={ACTION}>
            {hidden.elsewhere.label}
          </a>
        )}
        <button type="button" onClick={onClear} className={ACTION}>
          {hidden.showAll}
        </button>
      </span>
    </EmptyState>
  );
}
