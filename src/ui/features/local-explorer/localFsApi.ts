/**
 * Renderer-side client for the local-fs IPC surface. Every call is guarded by
 * window.electronAPI?.localFs so the browser build degrades to "not
 * available" instead of throwing.
 */
import type { LocalFsEntry, LocalFsReadResult } from "@/types/ui-types";

function api(): NonNullable<
  NonNullable<typeof window.electronAPI>["localFs"]
> | null {
  return window.electronAPI?.localFs ?? null;
}

export async function localFsAvailable(): Promise<boolean> {
  return (await api()?.available()) ?? false;
}

export function localFsHome(): Promise<string> {
  return api()?.home() ?? Promise.resolve("");
}

export function localFsList(
  root: string,
  rel: string,
): Promise<{ path: string; entries: LocalFsEntry[]; error?: string }> {
  return api()?.list(root, rel) ?? Promise.resolve({ path: rel, entries: [] });
}

export function localFsRead(
  root: string,
  rel: string,
): Promise<LocalFsReadResult> {
  return api()?.read(root, rel) ?? Promise.resolve({ error: "unknown" });
}

export function localFsOpen(target: string): Promise<boolean> {
  return api()?.open(target) ?? Promise.resolve(false);
}

/**
 * Home dir without its last segment — used as the tree root so the user can
 * still navigate above their home folder, like VS Code's workspace root.
 */
export function parentOfHome(home: string): string {
  if (!home) return "/";
  const parts = home.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/** Strips the root prefix to compute a relative path for the tree. */
export function toRel(root: string, abs: string): string {
  const normRoot = root.endsWith("/") && root.length > 1 ? root.slice(0, -1) : root;
  if (abs === normRoot) return "";
  if (abs.startsWith(normRoot + "/")) return abs.slice(normRoot.length + 1);
  return abs;
}
