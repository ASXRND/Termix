// Bottom preview section of the local file explorer: text/image/binary.
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/button";
import { localFsOpen } from "./localFsApi";
import type { LocalFsReadResult } from "@/types/ui-types";

export interface PreviewState {
  title: string;
  absPath: string;
  result: LocalFsReadResult | null;
  loading: boolean;
}

function isImage(
  result: LocalFsReadResult,
): result is Extract<LocalFsReadResult, { kind: "image" }> {
  return "kind" in result && result.kind === "image";
}

function isText(
  result: LocalFsReadResult,
): result is Extract<LocalFsReadResult, { kind: "text" }> {
  return "kind" in result && result.kind === "text";
}

export function PreviewSection({
  preview,
  onClose,
}: {
  preview: PreviewState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const result = preview.result;

  return (
    <div className="border-t border-sidebar-border px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground">
          {preview.title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          title={t("localExplorer.closePreview")}
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {preview.loading ? (
        <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("localExplorer.loading")}
        </div>
      ) : result === null ? (
        <div />
      ) : "error" in result ? (
        <p className="text-[11px] text-destructive">
          {t("localExplorer.error")}{" "}
          <span className="text-muted-foreground">({result.error})</span>
        </p>
      ) : isImage(result) ? (
        <img
          src={`data:${result.mime};base64,${result.base64}`}
          alt={preview.title}
          className="max-h-48 w-full rounded-md border border-sidebar-border object-contain"
        />
      ) : isText(result) ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[12px] leading-snug">
          {result.content}
        </pre>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            {t("localExplorer.binary")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void localFsOpen(preview.absPath)}
          >
            {t("localExplorer.openExternal")}
          </Button>
        </div>
      )}
    </div>
  );
}
