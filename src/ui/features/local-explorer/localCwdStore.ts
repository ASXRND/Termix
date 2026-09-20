/**
 * Tiny pub/sub for the working directory the local shell reported (OSC 7).
 * The terminal panels publish into it, the file explorer subscribes. Kept as a
 * module-level store so the two stay connected regardless of where they live
 * in the dock / split layout — no prop drilling through AppShell.
 */

const listeners = new Set<(dir: string) => void>();
let current: string | null = null;

/** Publishes the latest cwd; also replays it to the new subscribers. */
export function reportLocalCwd(dir: string): void {
  if (!dir) return;
  current = dir;
  for (const listener of listeners) listener(dir);
}

/** Last reported cwd, or null when nothing was reported yet. */
export function getLocalCwd(): string | null {
  return current;
}

/** Subscribes and immediately receives the current value when there is one. */
export function subscribeLocalCwd(listener: (dir: string) => void): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
  };
}
