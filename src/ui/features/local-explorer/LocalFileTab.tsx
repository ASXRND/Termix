// Local editor tab. Text files open in an editable CodeMirror buffer with
// Cmd/Ctrl+S saving straight back to disk; images and binaries get a read-only
// view with an "open in default app" escape hatch.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/button";
import { CodeEditor } from "@/features/file-manager/components/CodeEditor";
import type { Tab } from "@/types/ui-types";
import { localFsOpen, localFsRead, localFsWrite } from "./localFsApi";

type EditorState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "text" }
  | { phase: "image"; mime: string; base64: string }
  | { phase: "binary" };

export function LocalFileTab({
  tab,
  isVisible,
}: {
  tab: Tab;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const target = tab.localFile;
  const [state, setState] = useState<EditorState>({ phase: "loading" });
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  const dirty = state.phase === "text" && value !== savedValue;

  const load = useCallback(async () => {
    if (!target) return;
    setState({ phase: "loading" });
    setSaveError(null);
    const result = await localFsRead(target.root, target.rel);
    if ("error" in result) {
      setState({ phase: "error", error: result.error });
      return;
    }
    if (result.kind === "text") {
      setValue(result.content);
      setSavedValue(result.content);
      setState({ phase: "text" });
      return;
    }
    if (result.kind === "image") {
      setState({ phase: "image", mime: result.mime, base64: result.base64 });
      return;
    }
    setState({ phase: "binary" });
  }, [target]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  const save = useCallback(async () => {
    if (!target || state.phase !== "text") return;
    const result = await localFsWrite(target.root, target.rel, value);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    setSavedValue(value);
    setSaveError(null);
    setJustSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setJustSaved(false), 2000);
  }, [state.phase, target, value]);

  // Cmd/Ctrl+S saves, but only for the tab the user is actually looking at.
  useEffect(() => {
    if (!isVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isVisible, save]);

  const editable = state.phase === "text";

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={target?.absPath}
        >
          {target?.absPath}
        </span>
        {editable && dirty && (
          <span className="shrink-0 text-[11px] text-amber-500">
            {t("localExplorer.unsaved")}
          </span>
        )}
        {justSaved && (
          <span className="shrink-0 text-[11px] text-emerald-500">
            {t("localExplorer.saved")}
          </span>
        )}
        {editable && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 gap-1 px-2 text-[11px]"
              disabled={!dirty}
              title={t("localExplorer.saveHint")}
              onClick={() => void save()}
            >
              <Save className="h-3.5 w-3.5" />
              {t("localExplorer.save")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title={t("localExplorer.reload")}
              onClick={() => void load()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {target && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={t("localExplorer.openExternal")}
            onClick={() => void localFsOpen(target.absPath)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {saveError && (
        <p className="border-b border-border px-2 py-1 text-[11px] text-destructive">
          {t("localExplorer.saveFailed")} <span>({saveError})</span>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.phase === "loading" ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("localExplorer.loading")}
          </div>
        ) : state.phase === "error" ? (
          <div className="px-3 py-3">
            <p className="text-xs text-destructive">
              {t("localExplorer.error")}{" "}
              <span className="text-muted-foreground">({state.error})</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-6 px-2 text-[11px]"
              onClick={() => void load()}
            >
              {t("localExplorer.retry")}
            </Button>
          </div>
        ) : state.phase === "text" ? (
          <CodeEditor
            fileName={target?.name ?? "file"}
            value={value}
            placeholder=""
            onChange={setValue}
            onFocus={() => {}}
            onBlur={() => {}}
            fontSize={13}
          />
        ) : state.phase === "image" ? (
          <div className="flex h-full items-center justify-center overflow-auto p-3">
            <img
              src={`data:${state.mime};base64,${state.base64}`}
              alt={target?.name}
              className="max-h-full max-w-full rounded-md border border-border object-contain"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-3 px-3">
            <span className="text-xs text-muted-foreground">
              {t("localExplorer.binary")}
            </span>
            {target && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => void localFsOpen(target.absPath)}
              >
                {t("localExplorer.openExternal")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
