const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  openNativeRdp: (options) => ipcRenderer.invoke("open-native-rdp", options),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  getC2STunnelConfig: () => ipcRenderer.invoke("get-c2s-tunnel-config"),
  saveC2STunnelConfig: (config) =>
    ipcRenderer.invoke("save-c2s-tunnel-config", config),
  checkLocalPortAvailable: (host, port) =>
    ipcRenderer.invoke("check-local-port-available", host, port),
  getC2STunnelPresetDefaultName: () =>
    ipcRenderer.invoke("get-c2s-tunnel-preset-default-name"),
  startC2STunnel: (tunnel, index) =>
    ipcRenderer.invoke("start-c2s-tunnel", tunnel, index),
  testC2STunnel: (tunnel, index) =>
    ipcRenderer.invoke("test-c2s-tunnel", tunnel, index),
  stopC2STunnel: (tunnelName) =>
    ipcRenderer.invoke("stop-c2s-tunnel", tunnelName),
  getC2STunnelStatuses: () => ipcRenderer.invoke("get-c2s-tunnel-statuses"),
  onC2STunnelStatuses: (callback) => {
    const listener = (_event, statuses) => callback(statuses);
    ipcRenderer.on("c2s-tunnel-statuses", listener);
    return () => ipcRenderer.removeListener("c2s-tunnel-statuses", listener);
  },
  startC2SAutoStartTunnels: () =>
    ipcRenderer.invoke("start-c2s-autostart-tunnels"),

  onRemoteSyncStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("remote-sync-status-changed", listener);
    return () =>
      ipcRenderer.removeListener("remote-sync-status-changed", listener);
  },
  onCloseActiveTab: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("close-active-tab", listener);
    return () => ipcRenderer.removeListener("close-active-tab", listener);
  },

  clearSessionCookies: () => ipcRenderer.invoke("clear-session-cookies"),
  getSessionCookie: (name, targetUrl) =>
    ipcRenderer.invoke("get-session-cookie", name, targetUrl),
  waitForSessionCookie: (name, targetUrl, previousValue, timeoutMs) =>
    ipcRenderer.invoke(
      "wait-session-cookie",
      name,
      targetUrl,
      previousValue,
      timeoutMs,
    ),

  oidcSystemBrowserAuth: (authUrl, callbackPort) =>
    ipcRenderer.invoke("oidc-system-browser-auth", authUrl, callbackPort),

  openExternalEditor: (fileData) =>
    ipcRenderer.invoke("open-external-editor", fileData),
  closeExternalEditor: (editId) =>
    ipcRenderer.invoke("close-external-editor", editId),
  onExternalEditorSaved: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("external-editor-saved", listener);
    return () => ipcRenderer.removeListener("external-editor-saved", listener);
  },

  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  showOpenDialog: (options) => ipcRenderer.invoke("show-open-dialog", options),
  createTempFile: (fileData) =>
    ipcRenderer.invoke("create-temp-file", fileData),
  createTempFolder: (folderData) =>
    ipcRenderer.invoke("create-temp-folder", folderData),
  startDragToDesktop: (dragData) =>
    ipcRenderer.invoke("start-drag-to-desktop", dragData),
  cleanupTempFile: (tempId) => ipcRenderer.invoke("cleanup-temp-file", tempId),

  startLocalTerminal: (dimensions) =>
    ipcRenderer.invoke("local-terminal-start", dimensions),
  writeLocalTerminal: (sessionId, data) =>
    ipcRenderer.invoke("local-terminal-write", sessionId, data),
  readyLocalTerminal: (sessionId) =>
    ipcRenderer.invoke("local-terminal-ready", sessionId),
  resizeLocalTerminal: (sessionId, cols, rows) =>
    ipcRenderer.invoke("local-terminal-resize", sessionId, cols, rows),
  closeLocalTerminal: (sessionId) =>
    ipcRenderer.invoke("local-terminal-close", sessionId),
  onLocalTerminalData: (sessionId, callback) => {
    const channel = `local-terminal:data:${sessionId}`;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onLocalTerminalExit: (sessionId, callback) => {
    const channel = `local-terminal:exit:${sessionId}`;
    const listener = (_event, exitCode) => callback(exitCode);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onLocalTerminalCwd: (sessionId, callback) => {
    const channel = `local-terminal:cwd:${sessionId}`;
    const listener = (_event, dir) => callback(dir);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  localFs: {
    available: () => ipcRenderer.invoke("local-fs:available"),
    home: () => ipcRenderer.invoke("local-fs:home"),
    list: (root, rel) => ipcRenderer.invoke("local-fs:list", root, rel),
    read: (root, rel) => ipcRenderer.invoke("local-fs:read", root, rel),
    write: (root, rel, content) =>
      ipcRenderer.invoke("local-fs:write", root, rel, content),
    open: (target) => ipcRenderer.invoke("local-fs:open", target),
    reveal: (target) => ipcRenderer.invoke("local-fs:reveal", target),
    rename: (root, rel, name) =>
      ipcRenderer.invoke("local-fs:rename", root, rel, name),
    trash: (root, rel) => ipcRenderer.invoke("local-fs:trash", root, rel),
    duplicate: (root, rel) =>
      ipcRenderer.invoke("local-fs:duplicate", root, rel),
    copyInto: (root, sourceRel, destDirRel) =>
      ipcRenderer.invoke("local-fs:copy-into", root, sourceRel, destDirRel),
    create: (root, dirRel, kind) =>
      ipcRenderer.invoke("local-fs:create", root, dirRel, kind),
    clipboardFiles: () => ipcRenderer.invoke("local-fs:clipboard-files"),
    writeClipboardFiles: (paths) =>
      ipcRenderer.invoke("local-fs:clipboard-write-files", paths),
    copyExternalInto: (root, sourceAbs, destDirRel) =>
      ipcRenderer.invoke(
        "local-fs:copy-external-into",
        root,
        sourceAbs,
        destDirRel,
      ),
  },

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
  readText: () => ipcRenderer.invoke("clipboard-read-text"),
});

window.IS_ELECTRON = true;
