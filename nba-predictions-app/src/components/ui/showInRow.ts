import type { FocusEvent } from 'react';

/**
 * Brings a link or a button of a row that scrolls sideways into its row when
 * it takes the focus. A browser does that by itself only for an item that is
 * wholly outside the row. One that is cut off at the edge would keep the
 * focus where it is, with most of its ring out of sight.
 */
export function showInRow(event: FocusEvent<HTMLElement>): void {
  event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
