// User-ordered rail items. The rail ships with a default order; the user can
// drag buttons up and down and that order persists in localStorage so the
// favourite destinations land at the top. React-free and unit-testable.
const STORAGE_KEY = "railItemOrder";
export const RAIL_ORDER_EVENT = "railItemOrderChanged";

/**
 * Applies a saved order to the full item list: known ids are reordered, items
 * missing from the order list keep their default relative order and are
 * appended at the end (so a new upstream item never breaks the saved order).
 */
export function applyRailOrder<T extends { id: string }>(
  items: T[],
  order: string[],
): T[] {
  if (order.length === 0) return items;
  const index = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ia = index.get(a.id);
    const ib = index.get(b.id);
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}

/**
 * Reorders one id relative to a target id. `before` decides whether the item
 * lands above or below the target — the drag code passes this from where the
 * pointer was inside the target row.
 */
export function reorderRailIds(
  order: string[],
  dragId: string,
  targetId: string,
  before: boolean,
): string[] {
  if (dragId === targetId) return order;
  const ids = order.length ? [...order] : [];
  // A fresh order lists every id at its default position; callers seed it from
  // the visible items so this function only ever moves existing entries.
  const from = ids.indexOf(dragId);
  if (from === -1) return ids;
  ids.splice(from, 1);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex === -1) {
    ids.push(dragId);
    return ids;
  }
  ids.splice(before ? targetIndex : targetIndex + 1, 0, dragId);
  return ids;
}

/** Reads the persisted order, tolerating corrupted storage. */
export function readRailOrder(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** Persists the order and notifies every mounted rail. */
export function writeRailOrder(order: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  window.dispatchEvent(new Event(RAIL_ORDER_EVENT));
}

/** Resets the saved order (the "restore default order" action). */
export function resetRailOrder(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(RAIL_ORDER_EVENT));
}
