import { describe, expect, it } from "vitest";
import {
  completePathInput,
  completionMatches,
  joinAbsolute,
  longestCommonPrefix,
  splitCompletionInput,
} from "@/features/local-explorer/localPathComplete";

const ENTRIES = [
  { name: "Documents", isDir: true },
  { name: "Downloads", isDir: true },
  { name: "draft.txt", isDir: false },
  { name: "Desktop", isDir: true },
];

describe("splitCompletionInput", () => {
  it("lists the parent and keeps the incomplete segment as prefix", () => {
    expect(splitCompletionInput("/Users/ale")).toEqual({
      listDir: "/Users",
      prefix: "ale",
    });
  });

  it("treats a trailing slash as an empty prefix on that folder", () => {
    expect(splitCompletionInput("/Users/")).toEqual({
      listDir: "/Users",
      prefix: "",
    });
  });

  it("lists the root for a path without a slash", () => {
    expect(splitCompletionInput("/Use")).toEqual({
      listDir: "/",
      prefix: "Use",
    });
    expect(splitCompletionInput("Users")).toEqual({
      listDir: "/",
      prefix: "Users",
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(splitCompletionInput("  /Users/ale  ")).toEqual({
      listDir: "/Users",
      prefix: "ale",
    });
  });
});

describe("longestCommonPrefix", () => {
  it("finds the shared prefix, keeping the casing of the first name", () => {
    expect(longestCommonPrefix(["Documents", "downs"])).toBe("Do");
    expect(longestCommonPrefix(["Downloads"])).toBe("Downloads");
    expect(longestCommonPrefix(["Downloads", "Documents"])).toBe("Do");
    expect(longestCommonPrefix(["Desktop", "draft.txt"])).toBe("D");
  });

  it("returns an empty prefix for disjoint names and no names", () => {
    expect(longestCommonPrefix(["alpha", "beta"])).toBe("");
    expect(longestCommonPrefix([])).toBe("");
  });
});

describe("joinAbsolute", () => {
  it("does not double the slash at the root", () => {
    expect(joinAbsolute("/", "Users")).toBe("/Users");
    expect(joinAbsolute("/Users", "ale")).toBe("/Users/ale");
  });
});

describe("completionMatches", () => {
  it("matches case-insensitively, folders first, then alphabetically", () => {
    expect(completionMatches("/x/d", ENTRIES).map((e) => e.name)).toEqual([
      "Desktop",
      "Documents",
      "Downloads",
      "draft.txt",
    ]);
  });

  it("returns every entry when the prefix is empty", () => {
    expect(completionMatches("/Users/", ENTRIES)).toHaveLength(ENTRIES.length);
  });

  it("returns nothing for an unmatched prefix", () => {
    expect(completionMatches("/Users/zzz", ENTRIES)).toEqual([]);
  });
});

describe("completePathInput", () => {
  it("extends to the common prefix of several matches", () => {
    // Desktop / Documents / Downloads / draft.txt share just "d" ignoring case.
    expect(completePathInput("/x/d", ENTRIES)).toBe("/x/D");
    expect(
      completePathInput("/x/Do", [
        { name: "Documents", isDir: true },
        { name: "Downloads", isDir: true },
      ]),
    ).toBe("/x/Do");
  });

  it("adds a trailing slash when a single match is a directory", () => {
    expect(completePathInput("/Users/down", ENTRIES)).toBe("/Users/Downloads/");
  });

  it("leaves a single file match without a trailing slash", () => {
    expect(completePathInput("/Users/draft", ENTRIES)).toBe("/Users/draft.txt");
  });

  it("completes from the root without producing a double slash", () => {
    expect(
      completePathInput("/Applications", [
        { name: "Applications", isDir: true },
      ]),
    ).toBe("/Applications/");
  });

  it("returns null when nothing matches or the prefix is ambiguous", () => {
    expect(completePathInput("/Users/zzz", ENTRIES)).toBeNull();
    expect(
      completePathInput("/x/", [
        { name: "alpha", isDir: true },
        { name: "beta", isDir: true },
      ]),
    ).toBeNull();
  });
});
