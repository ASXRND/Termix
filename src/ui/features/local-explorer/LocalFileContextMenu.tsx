// Right-click menu for the local file tree: the standard file-manager set
// (open, reveal, copy, paste, duplicate, rename, delete, new file/folder).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  ExternalLink,
  Eye,
  FilePlus,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { localFsClipboardFiles } from "./localFsApi";

const VIEWPORT_PADDING = 8;

/**
 * True when something pasteable is around: an in-app clipboard entry or file
 * references on the system clipboard (files copied in Finder / Explorer).
 */
function usePasteAvailable(hasClipboard: boolean): boolean {
  const [systemFiles, setSystemFiles] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void localFsClipboardFiles()
      .then((res) => {
        if (!cancelled) setSystemFiles(res.paths.length > 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return hasClipboard || systemFiles;
}

export type LocalMenuAction =
  | "open"
  | "openExternal"
  | "reveal"
  | "copy"
  | "paste"
  | "duplicate"
  | "copyPath"
  | "rename"
  | "delete"
  | "newFile"
  | "newFolder"
  | "refresh";

type MenuEntry = {
  action: LocalMenuAction;
  icon: React.ReactNode;
  labelKey: string;
  shortcut?: string;
};

export function LocalFileContextMenu({
  x,
  y,
  isDirSelected,
  isFileSelected,
  hasClipboard,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  isDirSelected: boolean;
  isFileSelected: boolean;
  hasClipboard: boolean;
  onAction: (action: LocalMenuAction) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pasteAvailable = usePasteAvailable(hasClipboard);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the window once its real size is known.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - width - VIEWPORT_PADDING),
      top: Math.min(y, window.innerHeight - height - VIEWPORT_PADDING),
    });
  }, [x, y]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose]);

  const entries: MenuEntry[] = [];
  if (isFileSelected) {
    entries.push(
      {
        action: "open",
        icon: <Eye className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.menuOpen",
        shortcut: "⏎",
      },
      {
        action: "openExternal",
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.openExternal",
      },
    );
  } else if (isDirSelected) {
    entries.push(
      {
        action: "open",
        icon: <FolderSearch className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.menuOpenFolder",
      },
      {
        action: "newFile",
        icon: <FilePlus className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.newFile",
      },
      {
        action: "newFolder",
        icon: <FolderPlus className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.newFolder",
      },
    );
  }
  if (isFileSelected || isDirSelected) {
    entries.push({
      action: "reveal",
      icon: <FolderSearch className="h-3.5 w-3.5" />,
      labelKey: "localExplorer.reveal",
    });
  }
  if (isFileSelected || isDirSelected) {
    entries.push({
      action: "copy",
      icon: <Copy className="h-3.5 w-3.5" />,
      labelKey: "localExplorer.menuCopy",
      shortcut: "⌘C",
    });
    if (isDirSelected && pasteAvailable) {
      entries.push({
        action: "paste",
        icon: <ClipboardPaste className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.menuPaste",
        shortcut: "⌘V",
      });
    } else if (isFileSelected && pasteAvailable) {
      // VS Code behaviour: pasting on a file drops the clipboard entry next to
      // it, into that file's parent folder.
      entries.push({
        action: "paste",
        icon: <ClipboardPaste className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.menuPaste",
        shortcut: "⌘V",
      });
    }
    entries.push(
      {
        action: "duplicate",
        icon: <CopyPlus className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.duplicate",
      },
      {
        action: "copyPath",
        icon: <Copy className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.copyPath",
      },
      {
        action: "rename",
        icon: <Pencil className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.rename",
        shortcut: "F2",
      },
      {
        action: "delete",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.delete",
        shortcut: "⌫",
      },
    );
  } else {
    entries.push(
      {
        action: "newFile",
        icon: <FilePlus className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.newFile",
      },
      {
        action: "newFolder",
        icon: <FolderPlus className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.newFolder",
      },
    );
    if (pasteAvailable) {
      entries.push({
        action: "paste",
        icon: <ClipboardPaste className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.menuPaste",
      });
    }
    entries.push(
      {
        action: "copyPath",
        icon: <Copy className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.copyPath",
      },
      {
        action: "refresh",
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        labelKey: "localExplorer.refresh",
      },
    );
  }

  // Group id per action so separators fall between logical sections.
  const groupOf: Record<LocalMenuAction, number> = {
    open: 0,
    openExternal: 0,
    reveal: 0,
    newFile: 1,
    newFolder: 1,
    copy: 2,
    paste: 2,
    duplicate: 2,
    copyPath: 2,
    refresh: 2,
    rename: 3,
    delete: 3,
  };
  const items: (MenuEntry | "sep")[] = [];
  entries.forEach((entry, index) => {
    if (
      index > 0 &&
      groupOf[entries[index - 1].action] !== groupOf[entry.action]
    ) {
      items.push("sep");
    }
    items.push(entry);
  });

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[190px] rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === "sep" ? (
          <div key={`sep-${index}`} className="my-1 border-t border-border" />
        ) : (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onAction(item.action);
              onClose();
            }}
          >
            {item.icon}
            <span className="flex-1 truncate">{t(item.labelKey)}</span>
            {item.shortcut && (
              <span className="text-[10px] text-muted-foreground">
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
