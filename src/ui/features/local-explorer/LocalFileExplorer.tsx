import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CornerDownLeft,
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
  localFsHome,
  localFsList,
  localFsRead,
  normalizeDir,
  parentOfHome,
} from "./localFsApi";
import { getLocalCwd, subscribeLocalCwd } from "./localCwdStore";
import { addTreeChild, collapseTree, type LocalFsNode } from "./localFsTree";
import { LocalFileTree } from "./LocalFileTree";
import { PreviewSection, type PreviewState } from "./LocalFilePreview";

/**
 * VS Code style local file explorer for the right dock. Lives outside the
 * split container, so it stays visible no matter how the terminal area is
 * split. Reads the local FS over IPC (electron/local-fs.cjs) and follows the
 * working directory the local shell reports over OSC 7, with a manual path box
 * for when the user wants to pin a folder instead.
 */
export function LocalFileExplorer({ onClose }: { onClose: () => void }) {
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
  const [preview, setPreview] = useState<PreviewState | null>(null);

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
    setPreview(null);
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
      if (node.isDir) {
        setSelectedRel(node.rel);
        toggleDir(node);
        return;
      }
      if (node.children && node.children.length > 0) return;
      setSelectedRel(node.rel);
      setPreview({
        title: node.name,
        absPath: node.absPath,
        result: null,
        loading: true,
      });
      void (async () => {
        const result = await localFsRead(root ?? "", node.rel);
        setPreview((prev) =>
          prev && prev.absPath === node.absPath
            ? { ...prev, loading: false, result }
            : prev,
        );
      })();
    },
    [root, toggleDir],
  );

  const goToRoot = useCallback(() => {
    if (!home) return;
    // Explicit navigation wins over the terminal until the link is re-enabled.
    setFollow(false);
    setPathError(null);
    if (root === home) {
      setSelectedRel(null);
      setPreview(null);
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
        <div className="border-b border-sidebar-border px-2 py-1.5">
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
          {pathError && (
            <p className="mt-1 text-[11px] text-destructive">
              {t(`localExplorer.${pathError}`)}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
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
          />
        )}
      </div>

      {preview && (
        <PreviewSection preview={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
