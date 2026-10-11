import { showInRow } from '../../components/ui';
import { METHOD_PARTS, partAnchor, type MethodPart } from '../../display/method';

/**
 * Brings a part of the view to the top of the window and hands it the
 * focus, so that a keyboard or a screen reader goes on from there. The page
 * is put there at once, as it is wherever else it is moved: a glide down a
 * long view would still be under way when a visitor went on to another view,
 * and would leave that one scrolled part of the way down.
 */
function show(id: MethodPart): void {
  const part = document.getElementById(partAnchor(id));
  if (!part) return;
  part.scrollIntoView({ block: 'start' });
  part.focus({ preventScroll: true });
}

/**
 * The parts of the view as a row of buttons, each of which leads to its
 * part. They are buttons and not links: the address after the # names the
 * view, so a link to a part would lead away from it. On a phone the row
 * scrolls sideways inside its own box, out to both edges of the screen.
 */
export default function OnThisPage() {
  return (
    <nav aria-label="On this page" className="mb-5">
      {/* The room above and below is for the focus ring, which a box that scrolls would cut off. A button that is
          brought into the row comes to rest inside the padding at its sides. */}
      <ul className="no-scrollbar -mx-gutter -my-1 flex scroll-px-gutter gap-2 overflow-x-auto px-gutter py-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {METHOD_PARTS.map((part) => (
          <li key={part.id} className="shrink-0">
            <button
              type="button"
              onClick={() => show(part.id)}
              onFocus={showInRow}
              className="min-h-10 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:border-faint motion-safe:transition-colors"
            >
              {part.short}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
