// Shell integration for the local terminal: makes the interactive shell report
// its working directory with OSC 7 (ESC ] 7 ; file://HOST/PATH ST) — the same
// sequence VS Code and iTerm2 parse. zsh and bash need a prompt hook, which we
// inject through a generated rc file, so the user's own dotfiles keep working
// untouched.
const fs = require("fs");
const os = require("os");
const path = require("path");

// zsh: precmd hook, installed through add-zsh-hook when available.
const ZSH_HOOK = `__termix_osc7() {
  printf '\\033]7;file://%s%s\\033\\\\' "\${HOST:-localhost}" "$PWD"
}
if command -v add-zsh-hook >/dev/null 2>&1; then
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd __termix_osc7
else
  precmd_functions+=(__termix_osc7)
fi
__termix_osc7
`;

// bash: PROMPT_COMMAND hook, appended without clobbering an existing command.
const BASH_HOOK = `__termix_osc7() {
  printf '\\033]7;file://%s%s\\033\\\\' "\${HOSTNAME:-localhost}" "$PWD"
}
case "$PROMPT_COMMAND" in
  *__termix_osc7*) ;;
  "") PROMPT_COMMAND="__termix_osc7" ;;
  *) PROMPT_COMMAND="__termix_osc7;$PROMPT_COMMAND" ;;
esac
__termix_osc7
`;

/** "zsh" | "bash" | null for a shell binary path. */
function shellKind(shellFile) {
  const base = path.basename(String(shellFile || "")).toLowerCase();
  if (base.includes("zsh")) return "zsh";
  if (base.includes("bash")) return "bash";
  return null;
}

/** Sources the user's own dotfile when it exists, ignoring it otherwise. */
function sourceLine(fileName) {
  return `[ -f "$HOME/${fileName}" ] && . "$HOME/${fileName}"\n`;
}

function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
    // missing file: write it below
  }
  fs.writeFileSync(file, content, { mode: 0o600 });
}

/**
 * Prepares the rc files for one shell binary. Returns `{ args, env }` to merge
 * into the pty spawn, or null when the shell cannot be instrumented (Windows
 * PowerShell, fish, ...). Instrumentation is best-effort: swallowing errors
 * here must never block the terminal from starting.
 */
function buildShellIntegration(shellFile, options = {}) {
  const platform = options.platform || process.platform;
  const kind = shellKind(shellFile);
  if (platform === "win32" || !kind) return null;
  const home = options.home || os.homedir();
  const tmpRoot = options.tmpDir || os.tmpdir();
  const dir = path.join(tmpRoot, `termix-shell-integration-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (kind === "zsh") {
      // ZDOTDIR redirects every startup file into our directory, so each one
      // has to source its real counterpart from $HOME.
      writeIfChanged(path.join(dir, ".zshenv"), sourceLine(".zshenv"));
      writeIfChanged(path.join(dir, ".zprofile"), sourceLine(".zprofile"));
      writeIfChanged(path.join(dir, ".zlogin"), sourceLine(".zlogin"));
      writeIfChanged(path.join(dir, ".zshrc"), sourceLine(".zshrc") + ZSH_HOOK);
      // -l keeps the login-file chain; ZDOTDIR makes it read ours.
      return { args: ["-l"], env: { ZDOTDIR: dir } };
    }
    const rcFile = path.join(dir, "bashrc");
    // bash ignores --rcfile for login shells, so this runs as a non-login
    // interactive shell that pulls in the login/profile files itself.
    writeIfChanged(
      rcFile,
      sourceLine(".bash_profile") +
        sourceLine(".profile") +
        sourceLine(".bashrc") +
        BASH_HOOK,
    );
    return { args: ["--rcfile", rcFile], env: {} };
  } catch {
    return null;
  }
}

module.exports = {
  buildShellIntegration,
  shellKind,
  ZSH_HOOK,
  BASH_HOOK,
};
