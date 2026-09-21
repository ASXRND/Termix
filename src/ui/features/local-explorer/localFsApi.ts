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

/** Saves an editable file back to disk; used by the local editor tabs. */
export function localFsWrite(
  root: string,
  rel: string,
  content: string,
): Promise<{ ok?: boolean; error?: string }> {
  return (
    api()?.write(root, rel, content) ?? Promise.resolve({ error: "unknown" })
  );
}

/** Reveals a file or folder in the OS file manager. */
export function localFsReveal(target: string): Promise<boolean> {
  return api()?.reveal(target) ?? Promise.resolve(false);
}

export function localFsRename(
  root: string,
  rel: string,
  name: string,
): Promise<{ ok?: boolean; name?: string; error?: string }> {
  return (
    api()?.rename(root, rel, name) ?? Promise.resolve({ error: "unknown" })
  );
}

/** Recoverable delete: the entry goes to the OS trash, not oblivion. */
export function localFsTrash(
  root: string,
  rel: string,
): Promise<{ ok?: boolean; error?: string }> {
  return api()?.trash(root, rel) ?? Promise.resolve({ error: "unknown" });
}

export function localFsDuplicate(
  root: string,
  rel: string,
): Promise<{ ok?: boolean; name?: string; error?: string }> {
  return api()?.duplicate(root, rel) ?? Promise.resolve({ error: "unknown" });
}

/** Copies an entry into another folder of the same root (paste). */
export function localFsCopyInto(
  root: string,
  sourceRel: string,
  destDirRel: string,
): Promise<{ ok?: boolean; name?: string; error?: string }> {
  return (
    api()?.copyInto(root, sourceRel, destDirRel) ??
    Promise.resolve({ error: "unknown" })
  );
}

/** Reads file references (Finder copies) from the system clipboard. */
export function localFsClipboardFiles(): Promise<{
  paths: string[];
  error?: string;
}> {
  return (
    api()?.clipboardFiles() ?? Promise.resolve({ paths: [], error: "unknown" })
  );
}

/** Puts file references on the system clipboard (so Finder can paste). */
export function localFsWriteClipboardFiles(
  paths: string[],
): Promise<{ ok?: boolean; error?: string }> {
  return (
    api()?.writeClipboardFiles(paths) ?? Promise.resolve({ error: "unknown" })
  );
}

/** Copies an absolute path from outside the root into a root folder. */
export function localFsCopyExternalInto(
  root: string,
  sourceAbs: string,
  destDirRel: string,
): Promise<{ ok?: boolean; name?: string; error?: string }> {
  return (
    api()?.copyExternalInto(root, sourceAbs, destDirRel) ??
    Promise.resolve({ error: "unknown" })
  );
}

export function localFsCreate(
  root: string,
  dirRel: string,
  kind: "file" | "folder",
): Promise<{ ok?: boolean; name?: string; error?: string }> {
  return (
    api()?.create(root, dirRel, kind) ?? Promise.resolve({ error: "unknown" })
  );
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
  const normRoot =
    root.endsWith("/") && root.length > 1 ? root.slice(0, -1) : root;
  if (abs === normRoot) return "";
  if (abs.startsWith(normRoot + "/")) return abs.slice(normRoot.length + 1);
  return abs;
}

/**
 * Normalizes an absolute directory path coming from the shell (OSC 7) or from
 * manual input: URL-decodes, strips a trailing slash, rejects non-absolute or
 * obviously bogus input. Returns null when the path cannot be a directory.
 */
export function normalizeDir(dir: string): string | null {
  if (typeof dir !== "string" || !dir.trim()) return null;
  let value = dir.trim();
  // OSC 7 may deliver percent-encoded paths (spaces etc.).
  if (/%[0-9a-fA-F]{2}/.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value when decoding fails
    }
  }
  if (!value.startsWith("/")) return null;
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  if (value.includes("\0")) return null;
  return value;
}

/**
 * The directory itself followed by every ancestor up to "/". Used to fall back
 * to a readable folder when the shell reports a path that is gone or denied.
 */
export function ancestorsOf(dir: string): string[] {
  const normalized = normalizeDir(dir);
  if (!normalized) return [];
  const parts = normalized.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i -= 1) {
    out.push("/" + parts.slice(0, i).join("/"));
  }
  out.push("/");
  return out;
}

/**
 * First directory in the ancestor chain that the FS lets us list, or null when
 * even "/" fails. The probe is injected so the caller decides how to read the
 * filesystem (and so this stays unit-testable).
 */
export async function firstListable(
  dir: string,
  probe: (candidate: string) => Promise<{ error?: string }>,
): Promise<string | null> {
  for (const candidate of ancestorsOf(dir)) {
    const result = await probe(candidate);
    if (!result.error) return candidate;
  }
  return null;
}
