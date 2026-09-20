import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildShellIntegration,
  shellKind,
  BASH_HOOK,
  ZSH_HOOK,
} from "../../../../electron/shell-integration.cjs";

/** Isolated tmp dir per test file so nothing leaks between runs. */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "termix-si-test-"));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("shellKind", () => {
  it("recognizes zsh and bash by path", () => {
    expect(shellKind("/bin/zsh")).toBe("zsh");
    expect(shellKind("/usr/local/bin/bash")).toBe("bash");
  });

  it("returns null for shells without an OSC 7 hook", () => {
    expect(shellKind("/usr/bin/fish")).toBeNull();
    expect(shellKind("C:\\Windows\\System32\\cmd.exe")).toBeNull();
    expect(shellKind("")).toBeNull();
    expect(shellKind(undefined)).toBeNull();
  });
});

describe("buildShellIntegration", () => {
  it("redirects zsh startup files through ZDOTDIR", () => {
    const result = buildShellIntegration("/bin/zsh", {
      platform: "darwin",
      tmpDir: tmpRoot,
      home: "/Users/test",
    });
    expect(result?.args).toEqual(["-l"]);
    const dir = result?.env.ZDOTDIR;
    expect(typeof dir).toBe("string");
    for (const file of [".zshenv", ".zprofile", ".zlogin", ".zshrc"]) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true);
    }
  });

  it("sources the user's own zsh files before installing the hook", () => {
    const result = buildShellIntegration("/bin/zsh", { tmpDir: tmpRoot });
    const zshrc = fs.readFileSync(
      path.join(result.env.ZDOTDIR, ".zshrc"),
      "utf8",
    );
    expect(zshrc).toContain('[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"');
    expect(zshrc.indexOf("$HOME/.zshrc")).toBeLessThan(
      zshrc.indexOf("__termix_osc7"),
    );
    expect(zshrc).toContain("add-zsh-hook precmd __termix_osc7");
  });

  it("starts bash through a generated rcfile", () => {
    const result = buildShellIntegration("/bin/bash", {
      platform: "linux",
      tmpDir: tmpRoot,
    });
    expect(result?.env).toEqual({});
    expect(result?.args[0]).toBe("--rcfile");
    const rcFile = result?.args[1];
    expect(fs.existsSync(rcFile)).toBe(true);
  });

  it("keeps the user's bash login and rc files in the bash chain", () => {
    const result = buildShellIntegration("/bin/bash", { tmpDir: tmpRoot });
    const rc = fs.readFileSync(result.args[1], "utf8");
    expect(rc).toContain('[ -f "$HOME/.bash_profile" ]');
    expect(rc).toContain('[ -f "$HOME/.profile" ]');
    expect(rc).toContain('[ -f "$HOME/.bashrc" ]');
    expect(rc).toContain("PROMPT_COMMAND");
  });

  it("is not applied on Windows or for other shells", () => {
    expect(
      buildShellIntegration("/bin/zsh", { platform: "win32", tmpDir: tmpRoot }),
    ).toBeNull();
    expect(
      buildShellIntegration("/usr/bin/fish", { tmpDir: tmpRoot }),
    ).toBeNull();
  });

  it("returns null instead of throwing when the rc dir is unusable", () => {
    // A file where a directory is expected makes mkdirSync fail.
    const blocker = path.join(tmpRoot, "blocked");
    fs.writeFileSync(blocker, "not a dir");
    expect(buildShellIntegration("/bin/zsh", { tmpDir: blocker })).toBeNull();
  });

  it("does not rewrite the rc file when the content is unchanged", () => {
    const first = buildShellIntegration("/bin/zsh", { tmpDir: tmpRoot });
    const file = path.join(first.env.ZDOTDIR, ".zshrc");
    const before = fs.statSync(file).mtimeMs;
    buildShellIntegration("/bin/zsh", { tmpDir: tmpRoot });
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});

describe("OSC 7 hooks", () => {
  // The hooks carry a literal "\033" that printf turns into the ESC byte at
  // shell runtime — that is what keeps the rc file readable.
  const PRINTF_OSC7 = "printf '\\033]7;file://%s%s\\033\\\\'";

  it("prints a file:// OSC 7 sequence in the zsh hook", () => {
    expect(ZSH_HOOK).toContain(PRINTF_OSC7);
    expect(ZSH_HOOK).toContain('"${HOST:-localhost}" "$PWD"');
  });

  it("prints a file:// OSC 7 sequence in the bash hook", () => {
    expect(BASH_HOOK).toContain(PRINTF_OSC7);
    expect(BASH_HOOK).toContain('"${HOSTNAME:-localhost}" "$PWD"');
  });

  it("installs the bash hook without clobbering PROMPT_COMMAND", () => {
    expect(BASH_HOOK).toContain(
      'PROMPT_COMMAND="__termix_osc7;$PROMPT_COMMAND"',
    );
  });
});
