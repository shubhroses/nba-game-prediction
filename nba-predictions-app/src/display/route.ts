/**
 * The views of the page and their addresses. A view is linked by the part of
 * the address after the #, as in `#/record`, so the server has one page to
 * serve and a link to a view can be shared.
 */

export const VIEWS = [
  { key: 'games', label: 'Games' },
  { key: 'results', label: 'Results' },
  { key: 'record', label: 'Record' },
  { key: 'rankings', label: 'Rankings' },
  { key: 'method', label: 'How it works' },
] as const;

export type View = (typeof VIEWS)[number]['key'];

export const DEFAULT_VIEW: View = 'games';

export const SITE_TITLE = 'NBA Game Predictions';

export interface Route {
  view: View;
  /** What follows the view in the address, as in `#/results/2026-11-07`. Null when nothing does. The view decides what it means. */
  param: string | null;
}

function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The view an address asks for, from `location.hash`. An address that names no view shows the games. */
export function routeOf(hash: string): Route {
  const [name = '', ...rest] = hash.replace(/^#\/?/, '').split('/');
  const found = VIEWS.find((view) => view.key === name.toLowerCase());
  if (!found) return { view: DEFAULT_VIEW, param: null };
  const param = decoded(rest.join('/'));
  return { view: found.key, param: param === '' ? null : param };
}

/** The address of a view, for a link. */
export function hrefOf(view: View, param?: string): string {
  return param ? `#/${view}/${encodeURIComponent(param)}` : `#/${view}`;
}

/** The title of the document while a view is shown. */
export function titleOf(view: View): string {
  const label = VIEWS.find((entry) => entry.key === view)?.label;
  return view === DEFAULT_VIEW || label === undefined ? SITE_TITLE : `${label} · ${SITE_TITLE}`;
}
