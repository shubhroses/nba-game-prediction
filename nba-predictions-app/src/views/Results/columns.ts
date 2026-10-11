/**
 * The columns of a day on a wide screen, where its games are the rows of one
 * card: the game, the three sources, and room for the link that opens the
 * details. The row of column heads and every game are laid out on the same
 * columns, which is what lines them up. On a narrower screen a game is a
 * card of its own and none of this applies.
 */
export const COLUMNS = 'lg:grid lg:grid-cols-[minmax(0,5fr)_repeat(3,minmax(9.5rem,3fr))_5.5rem] lg:gap-x-6 lg:px-5';
