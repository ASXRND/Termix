import { describe, expect, it, beforeEach } from "vitest";
import {
  applyRailOrder,
  reorderRailIds,
  readRailOrder,
  writeRailOrder,
  resetRailOrder,
} from "../../sidebar/rail-order";

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("applyRailOrder", () => {
  it("keeps the default order when the saved order is empty", () => {
    expect(applyRailOrder(ITEMS, [])).toEqual(ITEMS);
  });

  it("reorders known ids and appends unknown-to-order items at the end", () => {
    expect(applyRailOrder(ITEMS, ["c", "a"])).toEqual([
      { id: "c" },
      { id: "a" },
      { id: "b" },
      { id: "d" },
    ]);
  });

  it("is stable for an order covering all ids", () => {
    expect(applyRailOrder(ITEMS, ["d", "c", "b", "a"])).toEqual([
      { id: "d" },
      { id: "c" },
      { id: "b" },
      { id: "a" },
    ]);
  });

  it("ignores order entries that reference missing items", () => {
    expect(applyRailOrder(ITEMS, ["zzz", "b", "yyy"])).toEqual([
      { id: "b" },
      { id: "a" },
      { id: "c" },
      { id: "d" },
    ]);
  });
});

describe("reorderRailIds", () => {
  it("moves the drag id above the target", () => {
    expect(reorderRailIds(["a", "b", "c"], "c", "a", true)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves the drag id below the target", () => {
    expect(reorderRailIds(["a", "b", "c"], "a", "c", false)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("is a no-op for equal ids and unknown drag ids", () => {
    expect(reorderRailIds(["a", "b"], "b", "b", true)).toEqual(["a", "b"]);
    expect(reorderRailIds(["a", "b"], "zzz", "a", true)).toEqual(["a", "b"]);
  });

  it("appends the drag id when the target id is unknown to the order", () => {
    expect(reorderRailIds(["a", "b"], "a", "zzz", true)).toEqual(["b", "a"]);
  });
});

describe("storage round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes and reads the order back", () => {
    writeRailOrder(["c", "a"]);
    expect(readRailOrder()).toEqual(["c", "a"]);
  });

  it("returns an empty array when storage holds garbage", () => {
    localStorage.setItem("railItemOrder", "{not json");
    expect(readRailOrder()).toEqual([]);
  });

  it("resetRailOrder clears the saved value", () => {
    writeRailOrder(["c", "a"]);
    resetRailOrder();
    expect(readRailOrder()).toEqual([]);
  });
});
