// User-ordered rail items. The rail ships with a default order; the user can
// drag buttons up and down and that order persists in localStorage so the
// favourite destinations land at the top. React-free and unit-testable.
const STORAGE_KEY = "railItemOrder";
export const RAIL_ORDER_EVENT = "railItemOrderChanged";

/**
 * Applies a saved order to the full item list. Items are keyed by `keyOf`;
 * duplicates (rendered separators all key as "sep") keep their relative order
 * and are placed between the ordered neighbours. Items missing from the order
 * list keep their default relative order and go to the end.
 */
export function applyRailOrder<T>(
  items: T[],
  order: string[],
  keyOf: (item: T) => string,
): T[] {
  if (order.length === 0) return items;
  const rank = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) {
    // First occurrence wins: duplicates in the order list are ignored.
    if (!rank.has(order[i])) rank.set(order[i], i);
  }
  // Group item indices by key so duplicates sort together, in list order.
  const groups = new Map<string, number[]>();
  items.forEach((item, i) => {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  // Stable comparator: primary = saved rank, secondary = default list index.
  return items
    .map((item, i) => ({ item, i, key: keyOf(item) }))
    .sort((a, b) => {
      const ra = rank.get(a.key);
      const rb = rank.get(b.key);
      if (ra === undefined && rb === undefined) return a.i - b.i;
      if (ra === undefined) return 1;
      if (rb === undefined) return -1;
      return ra - rb || a.i - b.i;
    })
    .map(({ item }) => item);
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

/**
 * Splits ordered rail buttons into rows, attaching each divider to the button
 * it follows. Dividers used to be standalone list entries which all shared one
 * sort key ("sep"), so the first custom order collapsed every divider into a
 * single block of lines (and the seeded order even stored them). Keeping the
 * flag on the button makes a divider travel with it and removes the duplicates
 * entirely. A divider is dropped after the last button; adjacent dividers are
 * collapsed into one line.
 */
export function railRows<T extends { separatorAfter?: boolean }>(
  items: T[],
): { item: T; separator: boolean }[] {
  const rows = items.map((item, i) => ({
    item,
    separator: Boolean(item.separatorAfter) && i < items.length - 1,
  }));
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].separator && rows[i - 1].separator) rows[i].separator = false;
  }
  return rows;
}

/** Reads the persisted order, tolerating corrupted storage. Legacy `sep` keys
 * are dropped: an earlier build seeded the order from the rendered list where
 * every divider was its own entry, and those keys made all dividers collapse
 * into one block of lines at the top of the rail.
 */
export function readRailOrder(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed)
      ? parsed.filter(
          (id) => typeof id === "string" && id.length > 0 && id !== "sep",
        )
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
