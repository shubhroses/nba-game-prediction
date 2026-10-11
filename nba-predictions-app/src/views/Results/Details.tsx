import { Disclosure, SourceName } from '../../components/ui';
import type { Fact, GameDetails } from '../../display/resultsGame';
import { formatDate } from '../../utils/formatters';

/** What a fact holds: its words, or its time in the visitor's own time zone. */
function Held({ fact }: { fact: Fact }) {
  if ('text' in fact) return <>{fact.text}</>;
  return <time dateTime={fact.time}>{formatDate(new Date(fact.time))}</time>;
}

interface DetailsProps {
  details: GameDetails;
  /** The game as a screen reader names it: "Milwaukee Bucks at Atlanta Hawks". */
  game: string;
}

/**
 * What the result line of a game holds, behind a line to open: when the game
 * started, and for each source what it said and when. On a wide screen the
 * line to open stands at the far end of the game's row, and what it opens
 * runs under the whole row.
 */
export default function Details({ details, game }: DetailsProps) {
  return (
    <Disclosure
      // Every game has such a line, and a screen reader hears which game this one is of.
      summary={
        <>
          Details<span className="sr-only"> of {game}</span>
        </>
      }
      className="border-t border-line lg:col-span-full lg:border-0"
      // The margin for scrolling keeps the line clear of what stays at the top of the window when the keyboard moves the
      // focus to it: the tabs, the title of the day, which is 2.75rem high, and on a wide screen the heads of the columns.
      // It takes the place of the smaller margin that everything in the content has for the tabs alone.
      summaryClassName="scroll-mt-[calc(theme(spacing.tabs)+5.25rem)] px-4 hover:text-muted lg:absolute lg:right-3 lg:top-6 lg:rounded-lg lg:px-2"
    >
      <div className="border-t border-line bg-sunken px-4 py-3.5 lg:mt-3.5 lg:rounded-lg lg:border lg:px-5 lg:py-4">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          {details.game.map((fact) => (
            <div key={fact.term} className="flex gap-1.5">
              <dt>{fact.term}</dt>
              <dd className="font-medium text-ink">
                <Held fact={fact} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-3.5 grid gap-4 lg:grid-cols-3 lg:gap-8">
          {details.sources.map((entry) => (
            <section key={entry.source}>
              <h4 className="text-sm">
                <SourceName source={entry.source} strong className="text-ink" />
              </h4>
              {entry.facts.length > 0 && (
                <dl className="mt-1.5 space-y-1 text-sm">
                  {entry.facts.map((fact) => (
                    <div key={fact.term} className="flex justify-between gap-4">
                      <dt className="shrink-0 text-muted">{fact.term}</dt>
                      <dd className="text-right font-medium text-ink">
                        <Held fact={fact} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {entry.notes.map((note) => (
                <p key={note} className="mt-1.5 text-xs text-muted">
                  {note}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Disclosure>
  );
}
