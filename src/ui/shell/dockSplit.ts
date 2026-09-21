// Geometry for the right dock split (file explorer above, live hosts below).
// Kept pure so the drag maths is testable without a DOM.

/** Smallest height the bottom panel may be dragged to. */
export const DOCK_SPLIT_MIN = 140;
/** Height the bottom panel starts at. */
export const DOCK_SPLIT_DEFAULT = 280;
/** Smallest height reserved for the panel above the divider. */
export const DOCK_SPLIT_TOP_MIN = 160;

/** Clamps a desired bottom-panel height to what the dock can actually give. */
export function clampDockSplitHeight(
  desired: number,
  containerHeight: number,
  topMin = DOCK_SPLIT_TOP_MIN,
): number {
  if (!Number.isFinite(desired)) return DOCK_SPLIT_DEFAULT;
  const max = Math.max(DOCK_SPLIT_MIN, containerHeight - topMin);
  return Math.min(Math.max(Math.round(desired), DOCK_SPLIT_MIN), max);
}

/**
 * Bottom-panel height for a divider at `clientY`: the distance from the
 * pointer down to the bottom edge of the dock.
 */
export function dockSplitHeightFromPointer(
  clientY: number,
  containerTop: number,
  containerHeight: number,
  topMin = DOCK_SPLIT_TOP_MIN,
): number {
  return clampDockSplitHeight(
    containerTop + containerHeight - clientY,
    containerHeight,
    topMin,
  );
}
