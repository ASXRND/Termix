import { describe, expect, it, vi } from "vitest";
import {
  addTreeChild,
  buildChildren,
  collapseTree,
  findNode,
  joinRel,
  rebuildTree,
} from "@/features/local-explorer/localFsTree";
import {
  ancestorsOf,
  firstListable,
  normalizeDir,
  parentOfHome,
  toRel,
} from "@/features/local-explorer/localFsApi";
import {
  getLocalCwd,
  reportLocalCwd,
  subscribeLocalCwd,
} from "@/features/local-explorer/localCwdStore";

describe("joinRel", () => {
  it("joins names without a leading slash at the root", () => {
    expect(joinRel("", "Documents")).toBe("Documents");
  });

  it("joins nested names with slashes", () => {
    expect(joinRel("Documents", "notes.txt")).toBe("Documents/notes.txt");
  });
});

describe("buildChildren", () => {
  it("creates rel and abs paths for every entry", () => {
    const nodes = buildChildren("/Users/x", "", [
      { name: "a.txt", isDir: false },
      { name: "sub", isDir: true },
    ]);
    expect(nodes.map((node) => node.rel)).toEqual(["a.txt", "sub"]);
    expect(nodes.map((node) => node.absPath)).toEqual([
      "/Users/x/a.txt",
      "/Users/x/sub",
    ]);
    expect(nodes[0].children).toEqual([]);
    expect(nodes[1].children).toBeNull();
  });

  it("handles a root of / without double slashes", () => {
    const nodes = buildChildren("/", "", [{ name: "etc", isDir: true }]);
    expect(nodes[0].absPath).toBe("/etc");
  });
});

describe("addTreeChild", () => {
  const root = {
    name: "",
    rel: "",
    absPath: "/Users/x",
    isDir: true,
    children: [] as never[],
  };

  it("fills the root children for the root rel", () => {
    const tree = addTreeChild(root, "", [{ name: "docs", isDir: true }]);
    expect(tree.children?.[0]?.name).toBe("docs");
  });

  it("fills a nested folder and keeps siblings intact", () => {
    let tree = addTreeChild(root, "", [
      { name: "docs", isDir: true },
      { name: "keep.txt", isDir: false },
    ]);
    tree = addTreeChild(tree, "docs", [{ name: "a.md", isDir: false }]);
    const docs = tree.children?.find((node) => node.name === "docs");
    expect(docs?.children?.map((node) => node.name)).toEqual(["a.md"]);
    expect(tree.children?.some((node) => node.name === "keep.txt")).toBe(true);
  });

  it("leaves the tree untouched for a stale path", () => {
    const tree = addTreeChild(root, "", [{ name: "docs", isDir: true }]);
    const stale = addTreeChild(tree, "ghost/deep", [
      { name: "x", isDir: false },
    ]);
    expect(stale).toEqual(tree);
  });
});

describe("collapseTree", () => {
  it("removes rel and every descendant, keeps the rest", () => {
    const expanded = collapseTree(
      { "": true, docs: true, "docs/sub": true, other: true },
      "docs",
    );
    expect(Object.keys(expanded).sort()).toEqual(["", "other"]);
  });
});

describe("findNode", () => {
  // The keyboard copy handler resolves the selected row through this lookup,
  // so a miss silently breaks ⌘C without any error.
  const tree = {
    name: "",
    rel: "",
    absPath: "/Users/x",
    isDir: true,
    children: [
      {
        name: "docs",
        rel: "docs",
        absPath: "/Users/x/docs",
        isDir: true,
        children: [
          {
            name: "notes.txt",
            rel: "docs/notes.txt",
            absPath: "/Users/x/docs/notes.txt",
            isDir: false,
          },
        ],
      },
      {
        name: "a.txt",
        rel: "a.txt",
        absPath: "/Users/x/a.txt",
        isDir: false,
      },
    ],
  };

  it("finds the root, a nested entry and a leaf", () => {
    expect(findNode(tree, "")?.rel).toBe("");
    expect(findNode(tree, "docs")?.name).toBe("docs");
    expect(findNode(tree, "docs/notes.txt")?.isDir).toBe(false);
    expect(findNode(tree, "a.txt")?.absPath).toBe("/Users/x/a.txt");
  });

  it("returns null for an unknown rel", () => {
    expect(findNode(tree, "docs/missing")).toBeNull();
  });

  it("tolerates a node without children", () => {
    expect(
      findNode({ name: "a", rel: "a", absPath: "/a", isDir: false }, "b"),
    ).toBeNull();
  });
});

describe("rebuildTree", () => {
  it("rebuilds regardless of listing order", () => {
    const tree = rebuildTree("/Users/x", [
      { rel: "docs/sub", entries: [{ name: "a.md", isDir: false }] },
      { rel: "", entries: [{ name: "docs", isDir: true }] },
      { rel: "docs", entries: [{ name: "sub", isDir: true }] },
    ]);
    const docs = tree.children?.[0];
    const sub = docs?.children?.[0];
    expect(docs?.name).toBe("docs");
    expect(sub?.rel).toBe("docs/sub");
    expect(sub?.children?.[0]?.name).toBe("a.md");
  });
});

describe("parentOfHome", () => {
  it("strips the last segment of the home dir", () => {
    expect(parentOfHome("/Users/alex")).toBe("/Users");
  });

  it("returns / when home is a root-level dir", () => {
    expect(parentOfHome("/root")).toBe("/");
  });

  it("falls back to / for an empty home", () => {
    expect(parentOfHome("")).toBe("/");
  });
});

describe("toRel", () => {
  it("returns an empty rel for the root itself", () => {
    expect(toRel("/Users/x", "/Users/x")).toBe("");
  });

  it("strips the root prefix", () => {
    expect(toRel("/Users/x", "/Users/x/docs/a.txt")).toBe("docs/a.txt");
  });

  it("trims a trailing slash on the root", () => {
    expect(toRel("/Users/x/", "/Users/x/docs")).toBe("docs");
  });
});

describe("normalizeDir", () => {
  it("keeps a plain absolute path", () => {
    expect(normalizeDir("/Users/x/project")).toBe("/Users/x/project");
  });

  it("trims whitespace and the trailing slash", () => {
    expect(normalizeDir("  /Users/x/project/  ")).toBe("/Users/x/project");
  });

  it("decodes percent-encoded paths coming from OSC 7", () => {
    expect(normalizeDir("/Users/x/My%20Docs")).toBe("/Users/x/My Docs");
  });

  it("keeps the raw value when decoding fails", () => {
    expect(normalizeDir("/Users/x/100%")).toBe("/Users/x/100%");
  });

  it("keeps the filesystem root intact", () => {
    expect(normalizeDir("/")).toBe("/");
  });

  it("rejects relative, empty and NUL-containing input", () => {
    expect(normalizeDir("relative/path")).toBeNull();
    expect(normalizeDir("")).toBeNull();
    expect(normalizeDir("   ")).toBeNull();
    expect(normalizeDir("/Users/x\0y")).toBeNull();
  });
});

describe("ancestorsOf", () => {
  it("walks from the directory itself up to the root", () => {
    expect(ancestorsOf("/a/b/c")).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  });

  it("handles the root itself", () => {
    expect(ancestorsOf("/")).toEqual(["/"]);
  });

  it("ignores a trailing slash", () => {
    expect(ancestorsOf("/a/b/")).toEqual(["/a/b", "/a", "/"]);
  });

  it("returns nothing for input that is not an absolute path", () => {
    expect(ancestorsOf("relative")).toEqual([]);
  });
});

describe("firstListable", () => {
  it("returns the directory itself when it can be listed", async () => {
    const probe = vi.fn().mockResolvedValue({ entries: [] });
    await expect(firstListable("/a/b/c", probe)).resolves.toBe("/a/b/c");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("falls back to the nearest readable ancestor", async () => {
    const probe = vi.fn(async (candidate: string) =>
      candidate === "/a" ? { entries: [] } : { error: "ENOENT" },
    );
    await expect(firstListable("/a/b/c", probe)).resolves.toBe("/a");
  });

  it("returns null when even the root cannot be listed", async () => {
    const probe = vi.fn().mockResolvedValue({ error: "EACCES" });
    await expect(firstListable("/a/b", probe)).resolves.toBeNull();
  });

  it("returns null for input that is not an absolute path", async () => {
    const probe = vi.fn().mockResolvedValue({ entries: [] });
    await expect(firstListable("nope", probe)).resolves.toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("localCwdStore", () => {
  it("reports the latest directory to new subscribers", () => {
    reportLocalCwd("/Users/x/project");
    const seen: string[] = [];
    const unsubscribe = subscribeLocalCwd((dir) => seen.push(dir));
    expect(seen).toEqual(["/Users/x/project"]);
    expect(getLocalCwd()).toBe("/Users/x/project");
    unsubscribe();
  });

  it("notifies live subscribers on every change", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLocalCwd((dir) => seen.push(dir));
    seen.length = 0;
    reportLocalCwd("/a");
    reportLocalCwd("/a/b");
    expect(seen).toEqual(["/a", "/a/b"]);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLocalCwd((dir) => seen.push(dir));
    unsubscribe();
    seen.length = 0;
    reportLocalCwd("/after");
    expect(seen).toEqual([]);
    expect(getLocalCwd()).toBe("/after");
  });

  it("ignores empty reports", () => {
    reportLocalCwd("/keep");
    reportLocalCwd("");
    expect(getLocalCwd()).toBe("/keep");
  });
});
