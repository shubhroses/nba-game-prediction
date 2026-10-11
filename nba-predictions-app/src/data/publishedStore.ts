/**
 * What the page holds of the published files other than the board: for each
 * file one state, which every component that shows the file reads, and at
 * most one request at a time, whoever asks. A file stays here when the view
 * that showed it is left, so the view has it at once when it is opened again.
 */
import { fetchPublishedTwice } from './published';
import { LOADING, publishedReducer, type PublishedAction, type PublishedState } from './publishedState';
import type { Parse } from './shape';

interface Entry {
  state: PublishedState<unknown>;
  /** The refresh key under which the file, or "no such file", was last answered. */
  answeredFor: string | null;
  /** The refresh key the page asked with last. */
  wanted: string | null;
  asking: boolean;
  listeners: Set<() => void>;
}

export interface PublishedStore {
  /**
   * What is known of the file at a path under the prefix. The object is the
   * same from one call to the next until something changes. A path is always
   * read with the same shape check, which is what gives its file a type.
   */
  stateOf<T>(path: string): PublishedState<T>;
  /** Calls `listener` whenever the state of the file changes. Returns how to stop. */
  subscribe(path: string, listener: () => void): () => void;
  /**
   * Asks for the file unless it was answered under this refresh key already
   * or a request for it is under way. `again` asks even after an answer, and
   * past the copy that the browser may keep of it: it is what a "Try again"
   * button does, and what the page does for a file whose answer does not go
   * with the board.
   */
  want<T>(path: string, parse: Parse<T>, refreshKey: string, again?: boolean): void;
}

/** A request of the store is never given up early: the answer is kept for whoever shows the file next. */
const NEVER = new AbortController().signal;

export function createPublishedStore(): PublishedStore {
  const entries = new Map<string, Entry>();

  function entryOf(path: string): Entry {
    let entry = entries.get(path);
    if (!entry) {
      entry = { state: LOADING, answeredFor: null, wanted: null, asking: false, listeners: new Set() };
      entries.set(path, entry);
    }
    return entry;
  }

  function change(entry: Entry, action: PublishedAction<unknown>): void {
    const next = publishedReducer(entry.state, action);
    if (next === entry.state) return;
    entry.state = next;
    entry.listeners.forEach((listener) => listener());
  }

  async function ask(path: string, entry: Entry, parse: Parse<unknown>, refreshKey: string, fresh: boolean): Promise<void> {
    entry.asking = true;
    change(entry, { type: 'asked' });
    const fetched = await fetchPublishedTwice(path, parse, NEVER, fresh);
    entry.asking = false;
    if (fetched.status !== 'failed') entry.answeredFor = refreshKey;
    change(entry, { type: 'answered', fetched });

    // The page went on to a newer snapshot while the request was under way.
    if (entry.wanted !== null && entry.wanted !== refreshKey) void ask(path, entry, parse, entry.wanted, false);
  }

  return {
    stateOf<T>(path: string) {
      return entryOf(path).state as PublishedState<T>;
    },
    subscribe(path, listener) {
      const { listeners } = entryOf(path);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    want<T>(path: string, parse: Parse<T>, refreshKey: string, again = false) {
      const entry = entryOf(path);
      entry.wanted = refreshKey;
      if (entry.asking || (!again && entry.answeredFor === refreshKey)) return;
      void ask(path, entry, parse, refreshKey, again);
    },
  };
}

/** The store of the page. */
export const publishedStore = createPublishedStore();
