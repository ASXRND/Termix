import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CornerDownLeft,
  File as FileIcon,
  Folder,
  Home,
  Link2,
  Link2Off,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  firstListable,
  localFsAvailable,
  localFsClipboardFiles,
  localFsCopyExternalInto,
  localFsCopyInto,
  localFsCreate,
  localFsDuplicate,
  localFsHome,
  localFsList,
  localFsRename,
  localFsReveal,
  localFsTrash,
  normalizeDir,
  parentOfHome,
} from "./localFsApi";
import { getLocalCwd, subscribeLocalCwd } from "./localCwdStore";
import {
  addTreeChild,
  collapseTree,
  findNode,
  joinRel,
  ROOT_REL,
  type LocalFsNode,
} from "./localFsTree";
import {
  entryFromNode,
  getCopiedEntry,
  setCopiedEntry,
} from "./localClipboard";
import {
  LocalFileContextMenu,
  type LocalMenuAction,
} from "./LocalFileContextMenu";
import { LocalFileNameDialog } from "./LocalFileNameDialog";
import { LocalFileTree } from "./LocalFileTree";
import {
  completePathInput,
  completionMatches,
  joinAbsolute,
  splitCompletionInput,
} from "@/lib/path-complete";
import type { LocalFileTarget } from "@/types/ui-types";
import { fileTarget } from "./localFileTabs";

/** One Tab-completion candidate shown under the path bar. */
type PathSuggestion = { name: string; isDir: boolean; path: string };

/** Cap on rendered candidates: the list is a picker, not a directory dump. */
const MAX_PATH_SUGGESTIONS = 8;

/**
 * VS Code style local file explorer for the right dock. Lives outside the
 * split container, so it stays visible no matter how the terminal area is
 * split. Reads the local FS over IPC (electron/local-fs.cjs) and follows the
 * working directory the local shell reports over OSC 7, with a manual path box
 * for when the user wants to pin a folder instead. Files open as editor tabs
 * via `onOpenFile`; the tree itself only browses and manages entries.
 */
export function LocalFileExplorer({
  onClose,
  onOpenFile,
}: {
  onClose: () => void;
  onOpenFile: (target: LocalFileTarget) => void;
}) {
  const { t } = useTranslation();
  const [booting, setBooting] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [pathInput, setPathInput] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [tree, setTree] = useState<LocalFsNode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  /** Tab-completion candidates for the path bar, plus the highlighted one. */
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    node: LocalFsNode | null;
    x: number;
    y: number;
  } | null>(null);
  const [nameDialog, setNameDialog] = useState<
    | { mode: "rename"; rel: string; initial: string }
    | { mode: "newFile" | "newFolder"; dirRel: string }
    | null
  >(null);
  /** Container of the tree; keyboard copy/paste only fire when focus is here. */
  const treeRef = useRef<HTMLDivElement>(null);
  /** Path bar wrapper: clicking outside it dismisses the Tab suggestions. */
  const pathBarRef = useRef<HTMLDivElement>(null);

  // A candidate list that survives a click somewhere else looks stuck, so
  // close it as soon as the pointer goes down outside the path bar.
  useEffect(() => {
    if (suggestions.length === 0) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && pathBarRef.current?.contains(target))
        return;
      setSuggestions([]);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [suggestions.length]);

  // Resolve the starting folder once: the home dir (so the tree does not open
  // at the device root), or wherever the local shell already reported being.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await localFsAvailable();
      if (cancelled) return;
      if (!available) {
        setInitError("notAvailable");
        setBooting(false);
        return;
      }
      const resolvedHome = await localFsHome();
      if (cancelled) return;
      if (!resolvedHome) {
        setInitError("homeError");
        setBooting(false);
        return;
      }
      const start = normalizeDir(resolvedHome) ?? parentOfHome(resolvedHome);
      const reported = normalizeDir(getLocalCwd() ?? "");
      setHome(start);
      setRoot(reported ?? start);
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the terminal: every `cd` the shell reports (OSC 7) moves the root.
  // Falls back to the nearest readable ancestor so the tree never goes blank
  // when the shell sits in a folder that was removed or is off limits.
  useEffect(() => {
    if (!follow) return;
    return subscribeLocalCwd((dir) => {
      const normalized = normalizeDir(dir);
      if (!normalized) return;
      void firstListable(normalized, (candidate) =>
        localFsList(candidate, ""),
      ).then((readable) => {
        if (!readable) return;
        setRoot((prev) => (prev === readable ? prev : readable));
      });
    });
  }, [follow]);

  // Keep the editable path bar in sync with the current root.
  useEffect(() => {
    if (root) setPathInput(root);
  }, [root]);

  const loadChildren = useCallback(async (rootPath: string, rel: string) => {
    setLoading(true);
    const res = await localFsList(rootPath, rel);
    setLoading(false);
    if (res.error) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setTree((prev) => {
      const base = prev ?? {
        name: "",
        rel: "",
        absPath: rootPath,
        isDir: true,
        children: [],
      };
      return addTreeChild(base, rel, res.entries);
    });
    setExpanded((prev) => ({ ...prev, [rel]: true }));
  }, []);

  // (Re)load the root whenever the root path changes.
  useEffect(() => {
    if (!root) return;
    setTree(null);
    setExpanded({});
    setSelectedRel(null);
    setLoadError(null);
    void loadChildren(root, "");
  }, [root, loadChildren]);

  const refresh = useCallback(async () => {
    if (!root || !tree) return;
    setLoading(true);
    const rootRes = await localFsList(root, "");
    if (rootRes.error) {
      setLoading(false);
      setLoadError(rootRes.error);
      return;
    }
    let next = addTreeChild(tree, "", rootRes.entries);
    const rels = Object.keys(expanded).filter(
      (rel) => rel !== "" && expanded[rel],
    );
    const results = await Promise.all(
      rels.map((rel) => localFsList(root, rel)),
    );
    results.forEach((res, index) => {
      if (res.error) return;
      next = addTreeChild(next, rels[index], res.entries);
    });
    setTree(next);
    setLoading(false);
    setLoadError(null);
  }, [root, tree, expanded]);

  const toggleDir = useCallback(
    (node: LocalFsNode) => {
      if (!root) return;
      if (expanded[node.rel]) {
        setExpanded((prev) => collapseTree(prev, node.rel));
      } else if (node.children === null) {
        void loadChildren(root, node.rel);
      }
    },
    [root, expanded, loadChildren],
  );

  const selectNode = useCallback(
    (node: LocalFsNode) => {
      setSelectedRel(node.rel);
      if (node.isDir) {
        toggleDir(node);
        return;
      }
      // Files open as editor tabs; AppShell dedupes by absolute path.
      if (root) onOpenFile(fileTarget(root, node.absPath, node.name));
    },
    [root, toggleDir, onOpenFile],
  );

  const openContextMenu = useCallback(
    (node: LocalFsNode, x: number, y: number) => {
      setSelectedRel(node.rel);
      setContextMenu({ node, x, y });
    },
    [],
  );

  // ---- clipboard operations ----------------------------------------------

  /** Paste target: a directory itself, or the parent of a selected file. */
  const pasteDestDirRel = useCallback((node: LocalFsNode | null): string => {
    if (!node) return ROOT_REL;
    return node.isDir
      ? node.rel
      : node.rel.includes("/")
        ? node.rel.slice(0, node.rel.lastIndexOf("/"))
        : ROOT_REL;
  }, []);

  /** Pastes the clipboard (in-app first, then OS file references) into dirRel. */
  const pasteIntoDir = useCallback(
    async (dirRel: string) => {
      if (!root) return;
      const clip = getCopiedEntry();
      if (clip) {
        const res = await localFsCopyInto(clip.root, clip.rel, dirRel);
        if (res.ok) void refresh();
        return;
      }
      // Fall back to files copied in the OS file manager (Finder puts file
      // references on the system clipboard).
      const system = await localFsClipboardFiles();
      if (!system.paths.length) return;
      for (const sourceAbs of system.paths) {
        const res = await localFsCopyExternalInto(root, sourceAbs, dirRel);
        if (res.error) return;
      }
      void refresh();
    },
    [root, refresh],
  );

  // Keyboard copy/paste (⌘C / ⌘V) for the tree selection. Works whenever the
  // local explorer is mounted and no text field owns the focus — requiring the
  // exact tree row to be focused made ⌘C silently fail after any click
  // elsewhere in the panel.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const accel = event.metaKey || event.ctrlKey;
      if (!accel || event.shiftKey || event.altKey) return;
      if (event.code !== "KeyC" && event.code !== "KeyV") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.code === "KeyC") {
        if (!selectedRel || !tree) return;
        const node = findNode(tree, selectedRel);
        if (node && node.rel !== "")
          setCopiedEntry(entryFromNode(root ?? "", node));
        return;
      }
      // KeyV
      const node = selectedRel && tree ? findNode(tree, selectedRel) : null;
      void pasteIntoDir(pasteDestDirRel(node));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRel, tree, root, pasteIntoDir, pasteDestDirRel]);

  // ---- context-menu operations -------------------------------------------

  const handleMenuAction = useCallback(
    async (action: LocalMenuAction) => {
      if (!root) return;
      const node = contextMenu?.node ?? null;
      switch (action) {
        case "open": {
          if (!node) return;
          if (node.isDir) {
            if (!expanded[node.rel]) toggleDir(node);
          } else {
            onOpenFile(fileTarget(root, node.absPath, node.name));
          }
          return;
        }
        case "openExternal":
          if (node) void window.electronAPI.localFs.open(node.absPath);
          return;
        case "reveal":
          if (node) void localFsReveal(node.absPath);
          return;
        case "copy":
          if (node) setCopiedEntry(entryFromNode(root, node));
          return;
        case "paste": {
          // Paste lands in the folder under the cursor; on a file it lands in
          // that file's parent folder (VS Code behaviour).
          await pasteIntoDir(pasteDestDirRel(node));
          return;
        }
        case "duplicate":
          if (!node) return;
          {
            const res = await localFsDuplicate(root, node.rel);
            if (res.ok) void refresh();
          }
          return;
        case "copyPath":
          if (node) void navigator.clipboard.writeText(node.absPath);
          return;
        case "rename":
          if (node && node.rel !== "")
            setNameDialog({
              mode: "rename",
              rel: node.rel,
              initial: node.name,
            });
          return;
        case "delete":
          if (!node || node.rel === "") return;
          {
            const res = await localFsTrash(root, node.rel);
            if (res.ok) {
              setSelectedRel(null);
              void refresh();
            }
          }
          return;
        case "newFile":
        case "newFolder":
          setNameDialog({ mode: action, dirRel: node?.rel ?? "" });
          return;
        case "refresh":
          void refresh();
          return;
      }
    },
    [
      root,
      contextMenu,
      expanded,
      toggleDir,
      onOpenFile,
      refresh,
      pasteDestDirRel,
      pasteIntoDir,
    ],
  );

  const submitNameDialog = useCallback(
    async (value: string) => {
      if (!root) return;
      const dialog = nameDialog;
      if (!dialog) return;
      if (dialog.mode === "rename") {
        const parentRel = dialog.rel.includes("/")
          ? dialog.rel.slice(0, dialog.rel.lastIndexOf("/"))
          : "";
        const res = await localFsRename(root, dialog.rel, value);
        if (res.ok) {
          setSelectedRel(joinRel(parentRel, res.name ?? value));
          void refresh();
        }
      } else {
        const res = await localFsCreate(
          root,
          dialog.dirRel,
          dialog.mode === "newFolder" ? "folder" : "file",
        );
        if (res.ok) {
          if (dialog.mode === "newFolder")
            setExpanded((prev) => ({
              ...prev,
              [joinRel(dialog.dirRel, res.name ?? value)]: false,
            }));
          void refresh();
        }
      }
      setNameDialog(null);
    },
    [root, nameDialog, refresh],
  );

  const goToRoot = useCallback(() => {
    if (!home) return;
    // Explicit navigation wins over the terminal until the link is re-enabled.
    setFollow(false);
    setPathError(null);
    if (root === home) {
      setSelectedRel(null);
      void loadChildren(home, "");
      return;
    }
    setRoot(home);
  }, [home, root, loadChildren]);

  const submitPath = useCallback(() => {
    const normalized = normalizeDir(pathInput);
    if (!normalized) {
      setPathError("invalidPath");
      return;
    }
    // A hand-typed path detaches the panel from the terminal.
    setFollow(false);
    setPathError(null);
    setRoot(normalized);
  }, [pathInput]);

  // Tab completion in the path bar, shell-style: list the directory being
  // typed, extend the last segment to the common prefix of the matches and,
  // when several candidates remain, offer the classic list to pick from.
  const completePath = useCallback(async () => {
    const { listDir, prefix } = splitCompletionInput(pathInput);
    const res = await localFsList(listDir, "");
    if (res.error) return;
    const matches = completionMatches(prefix, res.entries);
    if (matches.length === 0) {
      setSuggestions([]);
      return;
    }
    const completed = completePathInput(pathInput, res.entries);
    if (completed) {
      setPathInput(completed);
      setPathError(null);
    }
    // One match is already complete; more than one needs a list to choose from.
    setSuggestions(
      matches.length > 1
        ? matches.slice(0, MAX_PATH_SUGGESTIONS).map((match) => ({
            name: match.name,
            isDir: match.isDir,
            // Directories navigate, files open — keep the folder slash off the
            // value we hand to the navigation helper.
            path: joinAbsolute(listDir, match.name),
          }))
        : [],
    );
    setSuggestionIndex(0);
  }, [pathInput]);

  /** Navigates to a suggestion picked from the completion list. */
  const pickSuggestion = useCallback(
    (suggestion: PathSuggestion) => {
      setSuggestions([]);
      setPathInput(suggestion.path);
      if (suggestion.isDir) {
        // The path came straight from a directory listing, so it is valid.
        setFollow(false);
        setPathError(null);
        setRoot(suggestion.path);
        return;
      }
      // A file suggestion opens straight as an editor tab.
      if (!root) return;
      onOpenFile(fileTarget(root, suggestion.path, suggestion.name));
    },
    [onOpenFile, root],
  );

  const showSkeleton =
    booting || Boolean(root && !tree && !loadError && loading);

  // __JSX__
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("localExplorer.title")}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-pressed={follow}
            title={
              follow
                ? t("localExplorer.followOn")
                : t("localExplorer.followOff")
            }
            onClick={() => setFollow((prev) => !prev)}
          >
            {follow ? (
              <Link2 className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Link2Off className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={t("localExplorer.home")}
            onClick={goToRoot}
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={t("localExplorer.refresh")}
            disabled={!tree || loading || booting}
            onClick={() => void refresh()}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={t("localExplorer.close")}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {root && (
        <div
          ref={pathBarRef}
          className="border-b border-sidebar-border px-2 py-1.5"
        >
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitPath();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded border border-sidebar-border bg-background px-1.5 py-1 text-[11px] text-foreground outline-none focus:border-primary"
              value={pathInput}
              spellCheck={false}
              aria-label={t("localExplorer.pathLabel")}
              placeholder={t("localExplorer.pathPlaceholder")}
              title={root}
              onChange={(event) => {
                setPathInput(event.target.value);
                setPathError(null);
                setSuggestions([]);
              }}
              onKeyDown={(event) => {
                // Tab completes the typed path like a shell prompt.
                if (event.key === "Tab") {
                  event.preventDefault();
                  void completePath();
                  return;
                }
                if (suggestions.length === 0) {
                  if (event.key === "Escape") setSuggestions([]);
                  return;
                }
                // Arrow keys walk the candidate list, Enter takes the pick,
                // Escape closes it (Enter would otherwise navigate).
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSuggestionIndex((i) => (i + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSuggestionIndex(
                    (i) => (i - 1 + suggestions.length) % suggestions.length,
                  );
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  pickSuggestion(suggestions[suggestionIndex]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSuggestions([]);
                }
              }}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title={t("localExplorer.go")}
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
            </Button>
          </form>
          {suggestions.length > 0 && (
            <ul
              className="mt-1 max-h-44 overflow-y-auto rounded border border-sidebar-border bg-popover py-0.5 shadow-sm"
              role="listbox"
              aria-label={t("localExplorer.pathSuggestions")}
            >
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.path}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === suggestionIndex}
                    className={`flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left text-[11px] ${
                      index === suggestionIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                    title={suggestion.path}
                    onMouseEnter={() => setSuggestionIndex(index)}
                    onClick={() => pickSuggestion(suggestion)}
                  >
                    {suggestion.isDir ? (
                      <Folder className="h-3 w-3 shrink-0 text-accent-brand" />
                    ) : (
                      <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={`truncate ${
                        suggestion.isDir ? "" : "text-muted-foreground"
                      }`}
                    >
                      {suggestion.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pathError && (
            <p className="mt-1 text-[11px] text-destructive">
              {t(`localExplorer.${pathError}`)}
            </p>
          )}
        </div>
      )}

      <div ref={treeRef} className="min-h-0 flex-1 overflow-y-auto">
        {initError ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t(`localExplorer.${initError}`)}
          </p>
        ) : loadError ? (
          <div className="px-3 py-3">
            <p className="text-xs text-destructive">
              {t("localExplorer.error")}{" "}
              <span className="text-muted-foreground">({loadError})</span>
            </p>
            {root && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-6 px-2 text-[11px]"
                onClick={() => root && void loadChildren(root, "")}
              >
                {t("localExplorer.retry")}
              </Button>
            )}
          </div>
        ) : showSkeleton ? (
          <div className="flex flex-col gap-2 px-3 py-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${70 - row * 8}%` }}
              />
            ))}
          </div>
        ) : tree && (tree.children?.length ?? 0) === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {t("localExplorer.emptyDir")}
          </p>
        ) : (
          <LocalFileTree
            nodes={tree?.children ?? null}
            expanded={expanded}
            selectedRel={selectedRel}
            onToggle={toggleDir}
            onSelect={selectNode}
            onContextMenu={openContextMenu}
          />
        )}
      </div>

      {contextMenu && (
        <LocalFileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDirSelected={contextMenu.node?.isDir ?? false}
          isFileSelected={contextMenu.node ? !contextMenu.node.isDir : false}
          hasClipboard={Boolean(getCopiedEntry())}
          onAction={(action) => void handleMenuAction(action)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {nameDialog && (
        <LocalFileNameDialog
          title={t(
            nameDialog.mode === "rename"
              ? "localExplorer.rename"
              : nameDialog.mode === "newFile"
                ? "localExplorer.newFile"
                : "localExplorer.newFolder",
          )}
          initialValue={nameDialog.mode === "rename" ? nameDialog.initial : ""}
          onCancel={() => setNameDialog(null)}
          onSubmit={(value) => void submitNameDialog(value)}
        />
      )}
    </div>
  );
}
