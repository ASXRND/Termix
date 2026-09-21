// Pure helpers for the local editor tabs: turning a tree node into a tab
// target, de-duplicating tabs and tracking unsaved changes. React-free so the
// behaviour is unit-testable.
import type { LocalFileTarget, Tab } from "@/types/ui-types";
import { toRel } from "./localFsApi";

/** Builds the tab payload from the tree root plus an absolute path. */
export function fileTarget(
  root: string,
  absPath: string,
  name: string,
): LocalFileTarget {
  return { root, rel: toRel(root, absPath), absPath, name };
}

/** Label shown on the tab — the file name, with a fallback for odd names. */
export function fileTabLabel(target: LocalFileTarget): string {
  return target.name || target.absPath.split("/").pop() || "file";
}

/** True when the buffer differs from what was last read from / written to disk. */
export function isDirty(original: string, current: string): boolean {
  return original !== current;
}

/**
 * Id of the tab already showing this file, so clicking it twice focuses the
 * existing tab instead of opening a duplicate (VS Code behaviour).
 */
export function findFileTabId(
  tabs: Pick<Tab, "id" | "type" | "localFile">[],
  absPath: string,
): string | null {
  const match = tabs.find(
    (tab) => tab.type === "local-file" && tab.localFile?.absPath === absPath,
  );
  return match ? match.id : null;
}
