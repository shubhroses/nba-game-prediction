/** How the page puts words together. */

/** "Elo", "Elo and Sportsbooks", "Points & Rest, Elo and Sportsbooks". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
