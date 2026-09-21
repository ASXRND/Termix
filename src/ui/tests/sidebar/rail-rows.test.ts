import { describe, expect, it } from "vitest";
import { applyRailOrder, railRows } from "@/sidebar/rail-order";

type Item = { view: string; separatorAfter?: boolean };
const keyOf = (item: Item) => item.view;

describe("railRows", () => {
  it("attaches the divider to the button it follows", () => {
    const rows = railRows([
      { view: "hosts" },
      { view: "credentials", separatorAfter: true },
      { view: "termix-id" },
    ]);
    expect(rows.map((row) => [row.item.view, row.separator])).toEqual([
      ["hosts", false],
      ["credentials", true],
      ["termix-id", false],
    ]);
  });

  it("never draws a divider after the last button", () => {
    const rows = railRows([
      { view: "hosts" },
      { view: "credentials", separatorAfter: true },
    ]);
    expect(rows[1].separator).toBe(false);
  });

  it("returns no divider for a single button", () => {
    const rows = railRows([{ view: "hosts", separatorAfter: true }]);
    expect(rows).toEqual([
      { item: { view: "hosts", separatorAfter: true }, separator: false },
    ]);
  });

  it("collapses adjacent dividers into one line", () => {
    const rows = railRows([
      { view: "a", separatorAfter: true },
      { view: "b", separatorAfter: true },
      { view: "c" },
    ]);
    expect(rows.map((row) => row.separator)).toEqual([true, false, false]);
  });

  it("keeps a divider with its button after a custom order", () => {
    // Regression: dividers used to be standalone entries sharing one sort key,
    // so a saved order collapsed them all into a block of lines.
    const items: Item[] = [
      { view: "hosts" },
      { view: "credentials", separatorAfter: true },
      { view: "termix-id", separatorAfter: true },
      { view: "connections" },
    ];
    const ordered = applyRailOrder(items, ["connections", "hosts"], keyOf);
    const rows = railRows(ordered);
    expect(rows.map((row) => [row.item.view, row.separator])).toEqual([
      ["connections", false],
      ["hosts", false],
      ["credentials", true],
      ["termix-id", false],
    ]);
    // Exactly one divider line, not one per button.
    expect(rows.filter((row) => row.separator)).toHaveLength(1);
  });
});
