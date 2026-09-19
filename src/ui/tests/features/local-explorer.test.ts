import { describe, expect, it } from "vitest";
import {
  addTreeChild,
  buildChildren,
  collapseTree,
  joinRel,
  rebuildTree,
} from "@/features/local-explorer/localFsTree";
import { parentOfHome, toRel } from "@/features/local-explorer/localFsApi";

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
