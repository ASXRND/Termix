// In-app clipboard for the local file tree: "Copy" remembers an entry, "Paste"
// duplicates it into the folder under the cursor. Kept module-level so the
// entry survives the context menu closing (and works across two docks).
// "Copy" also mirrors the entry into the system clipboard as a file reference,
// so Finder / Explorer paste a real file instead of a text clipping.
import type { LocalFsNode } from "./localFsTree";

export type CopiedEntry = {
  /** Root the entry was copied from; paste re-authorises against its own root. */
  root: string;
  rel: string;
  name: string;
  isDir: boolean;
};

let copied: CopiedEntry | null = null;

export function setCopiedEntry(entry: CopiedEntry): void {
  copied = entry;
  // Fire-and-forget: if the system clipboard cannot hold file references
  // (browser build, permission errors), the in-app clipboard still works.
  void window.electronAPI?.localFs
    ?.writeClipboardFiles([`${entry.root}/${entry.rel}`.replace(/\/+$/, "")])
    .catch(() => {});
}

export function getCopiedEntry(): CopiedEntry | null {
  return copied;
}

export function clearCopiedEntry(): void {
  copied = null;
}

/** Builds the clipboard payload from a tree node. */
export function entryFromNode(root: string, node: LocalFsNode): CopiedEntry {
  return { root, rel: node.rel, name: node.name, isDir: node.isDir };
}
