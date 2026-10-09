// TV spatial navigation.
//
// Remote navigation is geometric rather than a single linear list: pressing
// right moves to whatever sits to the right of the focused element, down moves
// to the closest row below, and so on. Keeping the maths in one pure function
// makes the behaviour testable and predictable across screens.

const AXIS_WEIGHT = 1;
const CROSS_WEIGHT = 2.4;
const EDGE_TOLERANCE = 4;

function center(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function isVisible(rect) {
  return rect.width > 0 && rect.height > 0;
}

function distance(from, to, direction) {
  const a = center(from);
  const b = center(to);
  switch (direction) {
    case 'right': return { axis: b.x - a.x, cross: Math.abs(b.y - a.y) };
    case 'left': return { axis: a.x - b.x, cross: Math.abs(b.y - a.y) };
    case 'down': return { axis: b.y - a.y, cross: Math.abs(b.x - a.x) };
    case 'up': return { axis: a.y - b.y, cross: Math.abs(b.x - a.x) };
    default: return { axis: Infinity, cross: Infinity };
  }
}

function isInDirection(delta, rect, current, direction) {
  switch (direction) {
    case 'right': return delta.axis > EDGE_TOLERANCE;
    case 'left': return delta.axis > EDGE_TOLERANCE;
    case 'down': return delta.axis > EDGE_TOLERANCE;
    case 'up': return delta.axis > EDGE_TOLERANCE;
    default: return false;
  }
}

/**
 * Pick the element a D-pad press should move to.
 *
 * @param {HTMLElement[]} elements focusable elements in document order
 * @param {HTMLElement|null} current currently focused element
 * @param {'up'|'down'|'left'|'right'} direction
 * @returns {HTMLElement|null}
 */
export function nextFocusTarget(elements, current, direction) {
  const candidates = (elements || []).filter((element) => element && element !== current && !element.disabled);
  if (!candidates.length) return null;
  if (!current) return candidates[0];

  const currentRect = current.getBoundingClientRect();
  if (!isVisible(currentRect)) return candidates[0];

  let best = null;
  let bestScore = Infinity;

  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    if (!isVisible(rect)) continue;
    const delta = distance(currentRect, rect, direction);
    if (!isInDirection(delta, rect, current, direction)) continue;
    const score = delta.axis * AXIS_WEIGHT + delta.cross * CROSS_WEIGHT;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }

  if (best) return best;

  // Nothing directly ahead: wrap to the far edge of the same axis so the focus
  // never gets stuck (for example pressing right at the end of a rail).
  const wrapDirection = direction === 'left' || direction === 'up' ? direction : direction;
  const wrapping = candidates
    .filter((element) => isVisible(element.getBoundingClientRect()))
    .sort((a, b) => {
      const first = center(a.getBoundingClientRect());
      const second = center(b.getBoundingClientRect());
      switch (wrapDirection) {
        case 'right': return first.x - second.x;
        case 'left': return second.x - first.x;
        case 'down': return first.y - second.y;
        default: return second.y - first.y;
      }
    });
  return wrapping[0] || candidates[0];
}

export function focusableElements(root = document) {
  return Array.from(root.querySelectorAll('[data-tv-focus="true"]:not([disabled])'))
    .filter((element) => !element.hasAttribute('hidden'));
}

export function moveFocus({ direction, root = document } = {}) {
  const elements = focusableElements(root);
  if (!elements.length) return null;
  const current = elements.includes(document.activeElement) ? document.activeElement : null;
  const target = nextFocusTarget(elements, current, direction);
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  return target;
}
