// Minimal name prompt for the local tree: rename, new file, new folder.
// Self-contained modal so the explorer needs no extra dialog dependency.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";

export function LocalFileNameDialog({
  title,
  initialValue = "",
  onSubmit,
  onCancel,
}: {
  title: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Preselect the base name so typing replaces it but the extension stays.
    const dot = initialValue.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
  }, [initialValue]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-background/60 p-6"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-md border border-sidebar-border bg-popover p-3 shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="mb-2 text-xs font-medium text-foreground">{title}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="w-full rounded border border-sidebar-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            value={value}
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={onCancel}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={!value.trim()}
            >
              {t("common.confirm")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
