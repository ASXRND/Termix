// Pure tree helpers for the local file explorer. Kept free of React and
// window access so they are trivially unit-testable.
import type { LocalFsEntry } from "@/types/ui-types";

export const ROOT_REL = "";

export interface LocalFsNode {
  name: string;
  rel: string;
  absPath: string;
  isDir: boolean;
  children: LocalFsNode[] | null;
}

export function joinRel(rel: string, name: string): string {
  return rel === ROOT_REL ? name : `${rel}/${name}`;
}

/** Depth-first search of the tree for a node by its rel path. */
export function findNode(node: LocalFsNode, rel: string): LocalFsNode | null {
  if (node.rel === rel) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, rel);
    if (hit) return hit;
  }
  return null;
}

export function buildChildren(
  parentAbs: string,
  parentRel: string,
  entries: LocalFsEntry[],
): LocalFsNode[] {
  return entries.map((entry) => ({
    name: entry.name,
    rel: joinRel(parentRel, entry.name),
    absPath:
      parentAbs === "/" ? `/${entry.name}` : `${parentAbs}/${entry.name}`,
    isDir: entry.isDir,
    children: entry.isDir ? null : [],
  }));
}

/**
 * Replaces the children of the node at parentRel, rebuilding the spine
 * immutably. Unknown (stale) paths leave the tree untouched.
 */
export function addTreeChild(
  tree: LocalFsNode,
  parentRel: string,
  entries: LocalFsEntry[],
): LocalFsNode {
  if (parentRel === ROOT_REL) {
    return {
      ...tree,
      children: buildChildren(tree.absPath, ROOT_REL, entries),
    };
  }
  const segments = parentRel.split("/");
  const walk = (node: LocalFsNode, depth: number): LocalFsNode => {
    if (depth === segments.length) {
      return {
        ...node,
        children: buildChildren(node.absPath, node.rel, entries),
      };
    }
    const target = node.children?.find(
      (child) => child.name === segments[depth] && child.isDir,
    );
    if (!target) return node;
    return {
      ...node,
      children: (node.children ?? []).map((child) =>
        child === target ? walk(target, depth + 1) : child,
      ),
    };
  };
  return walk(tree, 0);
}

/** Collapses rel and every descendant of rel in an expanded-map. */
export function collapseTree(
  expanded: Record<string, boolean>,
  rel: string,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const key of Object.keys(expanded)) {
    if (key === rel || key.startsWith(`${rel}/`)) continue;
    next[key] = true;
  }
  return next;
}

/** What a click on a folder's chevron (or on its row) should do. */
export type DirToggleAction = "collapse" | "load" | "expand";

/**
 * Maps a folder click to an action. `collapseTree` drops the key from the
 * expanded map while the listing stays in `node.children`, so "not expanded"
 * has two meanings: a folder that was never opened (children === null, needs a
 * listing) and one the user merely collapsed (children present, only needs the
 * flag back). Without that distinction a collapsed folder stayed shut forever —
 * the old `children === null` check silently did nothing on the second click.
 */
export function dirToggleAction(
  expanded: Record<string, boolean>,
  node: Pick<LocalFsNode, "rel" | "children">,
): DirToggleAction {
  if (expanded[node.rel]) return "collapse";
  return node.children === null ? "load" : "expand";
}

const relDepth = (rel: string) =>
  rel === ROOT_REL ? 0 : rel.split("/").length;

/**
 * Rebuilds a tree from the root listing plus the listings of every expanded
 * folder. Parents are merged before children, so order of listings does not
 * matter beyond depth.
 */
export function rebuildTree(
  root: string,
  listings: Array<{ rel: string; entries: LocalFsEntry[] }>,
): LocalFsNode {
  let tree: LocalFsNode = {
    name: "",
    rel: ROOT_REL,
    absPath: root,
    isDir: true,
    children: [],
  };
  const sorted = [...listings].sort(
    (a, b) => relDepth(a.rel) - relDepth(b.rel),
  );
  for (const { rel, entries } of sorted) {
    tree = addTreeChild(tree, rel, entries);
  }
  return tree;
}
