import { useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { LINKS } from '../../display/links';
import { hrefOf, SITE_TITLE, VIEWS, type View } from '../../display/route';
import { Tabs, TextLink } from '../ui';

const TABS = VIEWS.map((view) => ({ ...view, href: hrefOf(view.key) }));

interface LayoutProps {
  /** The view that is shown, which the tabs mark. */
  view: View;
  /** The status line of the snapshot, once there is a board. */
  status?: ReactNode;
  /** For whoever has to hand the focus to the content, as after a load that was tried again. */
  main?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/** The frame of every view: the header, the tabs, the status line of the snapshot, the view and the footer. */
export default function Layout({ view, status, main: handed, children }: LayoutProps) {
  const own = useRef<HTMLElement>(null);
  const main = handed ?? own;

  // The address after the # names the view, so a link to #main would lead away from it. The link moves the focus itself.
  function skipToContent(event: MouseEvent) {
    event.preventDefault();
    main.current?.focus();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href={hrefOf(view)}
        onClick={skipToContent}
        // What shows the link when it has the focus also takes its padding away, so the padding is given for that state.
        className="sr-only left-2 top-2 z-30 rounded-lg bg-surface text-sm font-semibold text-ink shadow-card focus:not-sr-only focus:absolute focus:px-3 focus:py-2"
      >
        Skip to the content
      </a>

      <header className="on-header bg-header text-header-ink">
        <div className="mx-auto w-full max-w-6xl px-gutter pb-2 pt-5 sm:pt-7">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{SITE_TITLE}</h1>
          {/* A phone has no room for the line: it would take two lines of the first screen from the games. */}
          <p className="mt-1 hidden text-header-muted sm:block sm:text-base">Two models of its own, graded against the sportsbooks</p>
        </div>
      </header>

      {/* The tabs stay at the top of the window while the page scrolls, so that every view is one tap away.
          The line under them sets the bar off from a dark page, which is nearly the color of the header. */}
      <div className="on-header sticky top-0 z-20 h-tabs border-b border-header-muted/25 bg-header">
        {/* The five tabs fit a screen of 320px with this little room around them. From 380px on they have more. */}
        <Tabs label="Views" tabs={TABS} current={view} className="mx-auto w-full max-w-6xl pl-3 min-[380px]:px-2 sm:px-1" />
      </div>

      <main ref={main} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-gutter pb-10 pt-3 outline-none">
        {status && <div className="mb-5 sm:mb-6">{status}</div>}
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-gutter py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>The forecasts are for entertainment. They are not betting advice.</p>
          <ul className="flex gap-6">
            <li>
              <TextLink href={LINKS.repository} standalone>
                Source code
              </TextLink>
            </li>
            <li>
              <TextLink href={LINKS.data} standalone>
                Data
              </TextLink>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
