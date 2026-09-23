import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalFileExplorer } from "@/features/local-explorer/LocalFileExplorer";
import type { LocalFsEntry } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type ElectronTestWindow = Window &
  typeof globalThis & {
    electronAPI?: { localFs?: unknown };
  };

const LISTINGS: Record<string, LocalFsEntry[]> = {
  "": [
    { name: "docs", isDir: true },
    { name: "readme.md", isDir: false },
  ],
  docs: [{ name: "notes.txt", isDir: false }],
};

/** Installs a fake local-fs bridge; returns the listing spy. */
function stubLocalFs() {
  const list = vi.fn(async (_root: string, rel: string) => ({
    path: rel,
    entries: LISTINGS[rel] ?? [],
  }));
  (window as ElectronTestWindow).electronAPI = {
    localFs: {
      available: vi.fn(async () => true),
      home: vi.fn(async () => "/Users/x"),
      list,
    },
  } as unknown as ElectronTestWindow["electronAPI"];
  return { list };
}

/** Clicks the chevron of the folder row, the way the tree does it. */
async function clickFolderChevron(name: string) {
  const row = (await screen.findByText(name)).closest(
    '[role="treeitem"]',
  ) as HTMLElement;
  const chevron = row.querySelector("span[aria-hidden]") as HTMLElement;
  await userEvent.click(chevron);
}

function renderExplorer() {
  return render(<LocalFileExplorer onClose={vi.fn()} onOpenFile={vi.fn()} />);
}

describe("LocalFileExplorer folder rows", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete (window as ElectronTestWindow).electronAPI;
  });

  // Regression: "close the folder with the arrow, then it never opens again".
  // collapseTree drops the expanded key but the listing stays in the tree, so
  // the next click has to reopen the folder instead of doing nothing.
  it("reopens a folder that was collapsed with its chevron", async () => {
    stubLocalFs();
    renderExplorer();

    await screen.findByText("docs");
    expect(screen.queryByText("notes.txt")).toBeNull();

    await clickFolderChevron("docs");
    expect(await screen.findByText("notes.txt")).toBeTruthy();

    await clickFolderChevron("docs");
    expect(screen.queryByText("notes.txt")).toBeNull();

    await clickFolderChevron("docs");
    expect(await screen.findByText("notes.txt")).toBeTruthy();
  });

  it("reuses the cached listing when a collapsed folder is reopened", async () => {
    const { list } = stubLocalFs();
    renderExplorer();

    await screen.findByText("docs");
    await clickFolderChevron("docs");
    await screen.findByText("notes.txt");
    await clickFolderChevron("docs");
    await clickFolderChevron("docs");
    await screen.findByText("notes.txt");

    const docsCalls = list.mock.calls.filter((call) => call[1] === "docs");
    expect(docsCalls).toHaveLength(1);
  });
});
