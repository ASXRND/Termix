// Local file explorer IPC handlers. Mounted from main.cjs next to the
// local-terminal handlers. Everything is main-process fs so the renderer
// never touches Node APIs directly.
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { clipboard } = require("electron");

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
// Editors save through the same IPC surface; keep a sane ceiling so a broken
// renderer cannot push a huge buffer into the main process.
const MAX_WRITE_BYTES = 5 * 1024 * 1024;

function resolveInside(root, relative) {
  // Path traversal guard: ".." anywhere is rejected outright, and the resolved
  // path must still live under root.
  const rel = String(relative || "");
  if (rel.split(/[\\/]/).includes("..")) return null;
  const abs = path.resolve(root, "." + path.posix.join("/", rel));
  const rootAbs = path.resolve(root);
  const outside = path.relative(rootAbs, abs);
  if (outside.startsWith("..") || path.isAbsolute(outside)) return null;
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

/** Validates an editor save before it reaches the disk. */
function checkWritableContent(content) {
  if (typeof content !== "string") return "invalid";
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) return "toolarge";
  return null;
}

/**
 * Saves an existing file in place. Only regular files are written, and only
 * inside the root the renderer was already browsing (resolveInside).
 */
async function writeFileContent(root, rel, content) {
  const problem = checkWritableContent(content);
  if (problem) return { error: problem };
  const abs = resolveInside(root, rel);
  if (!abs || abs === path.resolve(root)) return { error: "forbidden" };
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) return { error: "eisdir" };
    await fsp.writeFile(abs, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { error: err.code || "unknown" };
  }
}

// ---------- tree operations (context menu) ----------

const NAME_RE = /^[^/\\\0]{1,255}$/;

/** Rejects names that would escape the folder or break the filesystem. */
function sanitizeName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!NAME_RE.test(trimmed)) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return trimmed;
}

/** "notes.txt" -> "notes copy.txt", then "notes copy 2.txt", ... */
function uniqueName(existingNames, wanted) {
  const taken = new Set(existingNames);
  if (!taken.has(wanted)) return wanted;
  const dot = wanted.lastIndexOf(".");
  const hasExt = dot > 0;
  const base = hasExt ? wanted.slice(0, dot) : wanted;
  const ext = hasExt ? wanted.slice(dot) : "";
  for (let i = 1; i < 1000; i += 1) {
    const candidate = i === 1 ? `${base} copy${ext}` : `${base} copy ${i}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} copy ${Date.now()}${ext}`;
}

/** Absolute path of a child, or null when it would leave the root. */
function childAbs(root, abs, name) {
  const target = path.join(path.dirname(abs), name);
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

async function renameEntry(root, rel, newName) {
  const name = sanitizeName(newName);
  if (!name) return { error: "invalidname" };
  const abs = resolveInside(root, rel);
  if (!abs || abs === path.resolve(root)) return { error: "forbidden" };
  const target = childAbs(root, abs, name);
  if (!target) return { error: "forbidden" };
  try {
    if (target !== abs && fs.existsSync(target)) return { error: "eexist" };
    await fsp.rename(abs, target);
    return { ok: true, name };
  } catch (err) {
    return { error: err.code || "unknown" };
  }
}

/** Deletes through the OS trash so a mis-click stays recoverable. */
async function trashEntry(root, rel) {
  const abs = resolveInside(root, rel);
  if (!abs || abs === path.resolve(root)) return { error: "forbidden" };
  try {
    await require("electron").shell.trashItem(abs);
    return { ok: true };
  } catch (err) {
    return { error: err.message || "unknown" };
  }
}

/** Duplicates an entry next to itself, keeping the "name copy" convention. */
async function duplicateEntry(root, rel) {
  const abs = resolveInside(root, rel);
  if (!abs || abs === path.resolve(root)) return { error: "forbidden" };
  try {
    const siblings = await fsp.readdir(path.dirname(abs));
    const name = uniqueName(siblings, path.basename(abs));
    await fsp.cp(abs, path.join(path.dirname(abs), name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    return { ok: true, name };
  } catch (err) {
    return { error: err.code || err.message || "unknown" };
  }
}

/** Copies an entry into another folder inside the same root (paste). */
async function copyEntryInto(root, sourceRel, destDirRel) {
  const src = resolveInside(root, sourceRel);
  const destDir = resolveInside(root, destDirRel);
  if (!src || !destDir || src === path.resolve(root)) {
    return { error: "forbidden" };
  }
  try {
    const srcStat = await fsp.stat(src);
    const destStat = await fsp.stat(destDir);
    if (!destStat.isDirectory()) return { error: "eisdir" };
    // Never copy a folder into itself or into its own subtree.
    if (
      srcStat.isDirectory() &&
      (destDir === src || destDir.startsWith(src + path.sep))
    ) {
      return { error: "forbidden" };
    }
    const siblings = await fsp.readdir(destDir);
    const name = uniqueName(siblings, path.basename(src));
    await fsp.cp(src, path.join(destDir, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    return { ok: true, name };
  } catch (err) {
    return { error: err.code || err.message || "unknown" };
  }
}

/** Creates an empty file or folder inside a directory. */
async function createEntry(root, dirRel, kind) {
  const dirAbs = resolveInside(root, dirRel);
  if (!dirAbs) return { error: "forbidden" };
  const wantFolder = kind === "folder";
  try {
    const stat = await fsp.stat(dirAbs);
    if (!stat.isDirectory()) return { error: "eisdir" };
    const entries = await fsp.readdir(dirAbs);
    const name = uniqueName(entries, wantFolder ? "New Folder" : "untitled.txt");
    const target = path.join(dirAbs, name);
    if (wantFolder) await fsp.mkdir(target);
    else await fsp.writeFile(target, "", { flag: "wx" });
    return { ok: true, name };
  } catch (err) {
    return { error: err.code || "unknown" };
  }
}

/** Reveals a file or folder in Finder / Explorer / the Linux file manager. */
function revealEntry(target) {
  if (typeof target !== "string" || !path.isAbsolute(target)) return false;
  try {
    require("electron").shell.showItemInFolder(target);
    return true;
  } catch {
    return false;
  }
}

// ---------- system clipboard file bridge ----------
// The in-app clipboard is invisible to the OS, so "Copy" also mirrors the
// entry into the system clipboard as file references and "Paste" can take
// files copied in Finder / Explorer. This kills the old bug where pasting
// into Finder produced a text clipping instead of a file.

/** file:///a%20b → /a b (scheme and authority stripped, percent-decoded). */
function fileUrlToPath(entry) {
  if (!entry.startsWith("file://")) return null;
  let p = entry.slice("file://".length);
  p = p.replace(/^[^/]+/, ""); // drop the authority part (empty locally)
  try {
    p = decodeURI(p);
  } catch {
    // keep the raw value when decoding fails
  }
  return p || null;
}

/** Absolute fs paths currently on the system clipboard as file references. */
function readClipboardFiles() {
  try {
    const raw = [];
    if (process.platform === "darwin") {
      // Finder puts one public.file-url item per file; Electron reads the
      // first item, so multi-file copies surface as a single entry.
      const value = clipboard.read("public.file-url");
      if (value) raw.push(...value.split("\n"));
    } else if (process.platform === "win32") {
      const value = clipboard.read("FileNameW");
      if (value) raw.push(...value.split(String.fromCharCode(0)));
    } else {
      const value = clipboard.read("text/uri-list");
      if (value)
        raw.push(
          ...value
            .split(/\r?\n/)
            .filter((line) => line && !line.startsWith("#")),
        );
    }
    const paths = [];
    for (const entry of raw) {
      const decoded = fileUrlToPath(entry.trim());
      if (decoded) paths.push(decoded);
    }
    return { paths };
  } catch (err) {
    return { paths: [], error: err.message || "unknown" };
  }
}

/** Puts absolute paths on the system clipboard as file references. */
function writeClipboardFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 128) {
    return { ok: false, error: "invalid" };
  }
  if (!paths.every((p) => typeof p === "string" && path.isAbsolute(p))) {
    return { ok: false, error: "invalid" };
  }
  try {
    if (process.platform === "win32") {
      // FileNameW: UTF-16 entries, each null-terminated, double-null at the end.
      const data = paths.map((p) => `${p}\0`).join("") + "\0";
      clipboard.writeBuffer("FileNameW", Buffer.from(data, "utf16le"));
    } else {
      const data = paths.map((p) => `file://${encodeURI(p)}`).join("\n");
      if (process.platform === "darwin") {
        clipboard.writeBuffer("public.file-url", Buffer.from(data, "utf8"));
      } else {
        clipboard.writeBuffer("text/uri-list", Buffer.from(`${data}\n`, "utf8"));
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "unknown" };
  }
}

/** Copies an absolute path (e.g. from the OS clipboard) into a root folder. */
async function copyExternalInto(root, sourceAbs, destDirRel) {
  const destDir = resolveInside(root, destDirRel);
  if (!destDir || typeof sourceAbs !== "string" || !path.isAbsolute(sourceAbs)) {
    return { error: "forbidden" };
  }
  try {
    const src = path.resolve(sourceAbs);
    const srcStat = await fsp.stat(src);
    const destStat = await fsp.stat(destDir);
    if (!destStat.isDirectory()) return { error: "eisdir" };
    // Never copy a folder into itself or into its own subtree.
    if (
      srcStat.isDirectory() &&
      (destDir === src || destDir.startsWith(src + path.sep))
    ) {
      return { error: "forbidden" };
    }
    const siblings = await fsp.readdir(destDir);
    const name = uniqueName(siblings, path.basename(src));
    await fsp.cp(src, path.join(destDir, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    return { ok: true, name };
  } catch (err) {
    return { error: err.code || err.message || "unknown" };
  }
}

function registerLocalFsIpc(ipcMain) {
  ipcMain.handle("local-fs:available", () => true);
  ipcMain.handle("local-fs:home", () => os.homedir());
  ipcMain.handle("local-fs:list", (_event, root, rel) => listDir(root, rel));
  ipcMain.handle("local-fs:read", (_event, root, rel) =>
    readPreview(root, rel),
  );
  ipcMain.handle("local-fs:write", (_event, root, rel, content) =>
    writeFileContent(root, rel, content),
  );
  ipcMain.handle("local-fs:open", (_event, target) => openPath(target));
  ipcMain.handle("local-fs:rename", (_event, root, rel, name) =>
    renameEntry(root, rel, name),
  );
  ipcMain.handle("local-fs:trash", (_event, root, rel) => trashEntry(root, rel));
  ipcMain.handle("local-fs:duplicate", (_event, root, rel) =>
    duplicateEntry(root, rel),
  );
  ipcMain.handle("local-fs:copy-into", (_event, root, sourceRel, destDirRel) =>
    copyEntryInto(root, sourceRel, destDirRel),
  );
  ipcMain.handle("local-fs:create", (_event, root, dirRel, kind) =>
    createEntry(root, dirRel, kind),
  );
  ipcMain.handle("local-fs:reveal", (_event, target) => revealEntry(target));
  ipcMain.handle("local-fs:clipboard-files", () => readClipboardFiles());
  ipcMain.handle("local-fs:clipboard-write-files", (_event, paths) =>
    writeClipboardFiles(paths),
  );
  ipcMain.handle("local-fs:copy-external-into", (_event, root, src, dest) =>
    copyExternalInto(root, src, dest),
  );
}

module.exports = {
  TEXT_PREVIEW_MAX_BYTES,
  MAX_WRITE_BYTES,
  resolveInside,
  classifyFile,
  checkWritableContent,
  writeFileContent,
  sanitizeName,
  uniqueName,
  renameEntry,
  trashEntry,
  duplicateEntry,
  copyEntryInto,
  createEntry,
  readClipboardFiles,
  writeClipboardFiles,
  copyExternalInto,
  registerLocalFsIpc,
  listDir,
  readPreview,
};
