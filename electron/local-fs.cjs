// Local file explorer IPC handlers. Mounted from main.cjs next to the
// local-terminal handlers. Everything is main-process fs so the renderer
// never touches Node APIs directly.
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

function resolveInside(root, relative) {
  // Path traversal guard: the resolved absolute path must stay under root.
  const abs = path.resolve(root, "." + path.posix.join("/", relative || ""));
  const rootAbs = path.resolve(root);
  const rel = path.relative(rootAbs, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

function sortEntries(entries) {
  // Folders first, then files; each group alphabetical, locale-aware.
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

const DIR_FILTER = new Set([
  "Library",
  "proc",
  "sys",
  "dev",
  "run",
  "Volumes",
  "mnt",
  "boot",
  "cdrom",
  "lost+found",
]);

async function listDir(root, rel) {
  const abs = resolveInside(root, rel);
  if (!abs) return { error: "forbidden" };
  try {
    const dirents = await fsp.readdir(abs, { withFileTypes: true });
    const entries = sortEntries(
      dirents
        .filter((d) => d.name !== ".DS_Store")
        .filter((d) => !(d.isDirectory() && DIR_FILTER.has(d.name)))
        .map((d) => ({
          name: d.name,
          isDir: d.isDirectory(),
        })),
    ).slice(0, 500);
    return { path: path.posix.join("/", rel || ""), entries };
  } catch (err) {
    return { error: err.code || "unknown" };
  }
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
]);

const BINARY_EXTENSIONS = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".dmg",
  ".iso",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".class",
  ".jar",
  ".war",
  ".pyc",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".wav",
  ".flac",
  ".ogg",
  ".pdf",
]);

function classifyFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  return "text";
}

async function readPreview(root, rel) {
  const abs = resolveInside(root, rel);
  if (!abs) return { error: "forbidden" };
  try {
    const stat = await fsp.stat(abs);
    if (stat.isDirectory()) return { error: "eisdir" };
    if (stat.size > TEXT_PREVIEW_MAX_BYTES) return { kind: "binary" };
    const kind = classifyFile(path.basename(abs));
    if (kind === "image") {
      return {
        kind: "image",
        mime: extToMime(path.extname(abs).toLowerCase()),
        base64: (await fsp.readFile(abs)).toString("base64"),
      };
    }
    if (kind === "binary") return { kind: "binary" };
    const handle = await fsp.open(abs, "r");
    try {
      // Read a few extra bytes so a truncated tail is still a valid
      // UTF-8 boundary for Buffer.toString.
      const length = Math.min(stat.size, TEXT_PREVIEW_MAX_BYTES);
      const buffer = Buffer.alloc(length + 4);
      const { bytesRead } = await handle.read(buffer, 0, length + 4, 0);
      return { kind: "text", content: buffer.toString("utf8", 0, bytesRead) };
    } finally {
      await handle.close();
    }
  } catch (err) {
    return { error: err.code || "unknown" };
  }
}

function extToMime(ext) {
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

async function openPath(target) {
  if (typeof target !== "string") return false;
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return false;
    // shell.openPath resolves with an error string ("" when fine).
    const error = await require("electron").shell.openPath(target);
    return !error;
  } catch {
    return false;
  }
}

function registerLocalFsIpc(ipcMain) {
  ipcMain.handle("local-fs:available", () => true);
  ipcMain.handle("local-fs:home", () => os.homedir());
  ipcMain.handle("local-fs:list", (_event, root, rel) => listDir(root, rel));
  ipcMain.handle("local-fs:read", (_event, root, rel) =>
    readPreview(root, rel),
  );
  ipcMain.handle("local-fs:open", (_event, target) => openPath(target));
}

module.exports = {
  TEXT_PREVIEW_MAX_BYTES,
  resolveInside,
  classifyFile,
  registerLocalFsIpc,
  listDir,
  readPreview,
};
