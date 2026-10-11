import type { Board } from '../../data/board';
import { clockTime, nextUpdateNote, snapshotAge, snapshotTime } from '../../display/statusLine';

interface StatusLineProps {
  board: Board;
  /** When this page received the board. */
  fetchedAt: number;
  now: number;
}

export default function StatusLine({ board, fetchedAt, now }: StatusLineProps) {
  return (
    <p className="text-gray-600 mb-1" title={`This page received these odds at ${clockTime(fetchedAt, now)}`}>
      {/* A screen reader reads a status region out when its text changes. Only the time of the
          snapshot is in it: the age after it changes every minute. */}
      <span role="status">{snapshotTime(board, now)}</span> {snapshotAge(board, now)} {nextUpdateNote(board, now)}
    </p>
  );
}
