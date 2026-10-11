import { useCallback, useSyncExternalStore } from 'react';
import { MY_TEAMS_KEY, readMyTeams, withToggled, writeMyTeams } from '../data/myTeams';

/** The browser's storage, or null when the browser refuses to hand it out. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// One set for the whole page, so that every component that shows it agrees.
let teams: ReadonlySet<string> | null = null;
let kept = true;
const listeners = new Set<() => void>();

function current(): ReadonlySet<string> {
  teams ??= new Set(readMyTeams(storage()));
  return teams;
}

function replace(next: ReadonlySet<string>): void {
  teams = next;
  kept = writeMyTeams(storage(), next);
  listeners.forEach((listener) => listener());
}

/** Another tab of the same browser changed what is stored. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== MY_TEAMS_KEY) return;
  teams = null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export interface MyTeams {
  /** The codes of the teams the visitor follows. */
  teams: ReadonlySet<string>;
  /** Adds a team, or takes it out when it is among them. */
  toggle: (code: string) => void;
  /** False when the last change could not be stored: the teams then last until the page is closed. */
  kept: boolean;
}

/**
 * The teams a visitor follows. They are kept in the browser's storage and
 * nowhere else. Where the browser has no storage, or blocks it, the hook
 * works all the same and the teams are forgotten with the page.
 */
export function useMyTeams(): MyTeams {
  const followed = useSyncExternalStore(subscribe, current);
  const toggle = useCallback((code: string) => replace(withToggled(current(), code)), []);
  return { teams: followed, toggle, kept };
}
