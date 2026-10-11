import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { hrefOf, routeOf, titleOf, type Route, type View } from '../display/route';

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

function currentHash(): string {
  return window.location.hash;
}

/**
 * The view that the address asks for, followed as the address changes. The
 * title of the document follows the view.
 */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash);
  const route = useMemo(() => routeOf(hash), [hash]);

  useEffect(() => {
    document.title = titleOf(route.view);
  }, [route.view]);

  return route;
}

/**
 * Puts what follows a view into the address without adding a step to the
 * browser's history, for a choice inside a view that a visitor may make many
 * times over: Back then leaves the view, however often they chose. The
 * address can be linked to and is still there when the page is loaded again.
 * The page follows it through the event that a link raises as well.
 */
export function replaceRoute(view: View, param: string): void {
  window.history.replaceState(null, '', hrefOf(view, param));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// Every load of the page names its entries anew, so that a name from before a reload is not taken for one of this load.
const LOAD = Math.random().toString(36).slice(2, 12);
let named = 0;

/** How far down the page was in each entry of the browser's history that it has shown since it was loaded. */
const positions = new Map<string, number>();

/** The name that this page gave an entry of the history when it first showed it. Null for an entry it has not shown. */
function entryName(state: unknown): string | null {
  return typeof state === 'object' && state !== null && 'entry' in state && typeof state.entry === 'string' ? state.entry : null;
}

/**
 * Where the page stands when the view changes. A view that a visitor goes to
 * starts at its top, wherever the one before it was scrolled to. A view that
 * they come back to, with Back or Forward, is put where they left it.
 *
 * The two are told apart by the entry of the browser's history: the page
 * writes a name into every entry it shows, so an entry without one is new,
 * and an entry with one has been shown before. How far down the page was is
 * noted for each entry as the visitor scrolls. A change inside a view, such
 * as another day, is left to the view.
 *
 * On a step of the history the browser scrolls the page by itself, before
 * the address changes for the page and while the view of the entry that was
 * left is still drawn. That is no place the visitor chose, so nothing is
 * noted from the step until the view of the new entry is drawn.
 */
export function useViewScroll(view: View): void {
  const hash = useSyncExternalStore(subscribe, currentHash);
  const shown = useRef<{ view: View; entry: string } | null>(null);
  const stepping = useRef(false);

  useEffect(() => {
    const note = () => {
      if (shown.current && !stepping.current) positions.set(shown.current.entry, window.scrollY);
    };
    const step = () => {
      stepping.current = entryName(window.history.state) !== shown.current?.entry;
    };
    window.addEventListener('scroll', note, { passive: true });
    window.addEventListener('popstate', step);
    return () => {
      window.removeEventListener('scroll', note);
      window.removeEventListener('popstate', step);
    };
  }, []);

  // Before the browser draws the view, so that nothing it scrolls after this is noted for the entry that was left.
  useLayoutEffect(() => {
    stepping.current = false;
    const changed = shown.current !== null && shown.current.view !== view;
    const known = entryName(window.history.state);
    if (known !== null) {
      const left = positions.get(known);
      if (changed && left !== undefined) window.scrollTo(0, left);
      shown.current = { view, entry: known };
      return;
    }

    named += 1;
    const entry = `${LOAD}:${named}`;
    window.history.replaceState({ entry }, '');
    if (changed) window.scrollTo(0, 0);
    shown.current = { view, entry };
  }, [hash, view]);
}
