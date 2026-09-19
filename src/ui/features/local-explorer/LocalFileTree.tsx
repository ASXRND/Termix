// Presentational recursive tree for the local file explorer, VS Code style.
import {
  ChevronRight,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROOT_REL, type LocalFsNode } from "./localFsTree";

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "py",
  "sh",
  "bash",
  "zsh",
  "c",
  "h",
  "cpp",
  "hpp",
  "java",
  "rb",
  "go",
  "rs",
  "php",
  "sql",
  "yml",
  "yaml",
  "toml",
  "xml",
  "html",
  "css",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "log",
  "cfg",
  "conf",
  "ini",
  "env",
  "properties",
  "gitignore",
  "editorconfig",
]);

function fileIconFor(name: string) {
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (IMAGE_EXTENSIONS.has(ext)) return ImageIcon;
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (TEXT_EXTENSIONS.has(ext)) return FileText;
  return File;
}

interface LocalFileTreeProps {
  nodes: LocalFsNode[] | null;
  expanded: Record<string, boolean>;
  selectedRel: string | null;
  onToggle: (node: LocalFsNode) => void;
  onSelect: (node: LocalFsNode) => void;
}

export function LocalFileTree({
  nodes,
  expanded,
  selectedRel,
  onToggle,
  onSelect,
}: LocalFileTreeProps) {
  if (!nodes) return null;
  return (
    <div role="tree" className="flex flex-col px-1.5 py-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.rel}
          node={node}
          depth={0}
          expanded={expanded}
          selectedRel={selectedRel}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: LocalFsNode;
  depth: number;
  expanded: Record<string, boolean>;
  selectedRel: string | null;
  onToggle: (node: LocalFsNode) => void;
  onSelect: (node: LocalFsNode) => void;
}

function TreeNode({
  node,
  depth,
  expanded,
  selectedRel,
  onToggle,
  onSelect,
}: TreeNodeProps) {
  const isOpen =
    node.isDir && (node.rel === ROOT_REL ? true : Boolean(expanded[node.rel]));
  const selected = selectedRel === node.rel;
  const FileIcon = node.isDir ? null : fileIconFor(node.name);

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={node.isDir ? isOpen : undefined}
        tabIndex={0}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node);
          }
        }}
        className={cn(
          "flex h-7 w-full cursor-pointer select-none items-center gap-1 rounded-md pr-2 text-left text-[13px] outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring",
          selected && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {node.isDir ? (
          <span
            aria-hidden
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node);
            }}
            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
          </span>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        {node.isDir ? (
          isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          FileIcon && (
            <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDir && isOpen && node.children && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.rel}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedRel={selectedRel}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
