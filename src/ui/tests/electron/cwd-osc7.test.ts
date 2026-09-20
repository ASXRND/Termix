import { describe, expect, it } from "vitest";
import { createOsc7Detector } from "../../../../electron/cwd-osc7.cjs";

describe("createOsc7Detector", () => {
  it("parses a BEL-terminated OSC 7", () => {
    const detector = createOsc7Detector();
    const found = detector.push("\x1b]7;file://macbook.local/Users/x\x07");
    expect(found).toEqual(["/Users/x"]);
  });

  it("parses a ST-terminated OSC 7", () => {
    const detector = createOsc7Detector();
    const found = detector.push("\x1b]7;file://host/Users/x\x1b\\");
    expect(found).toEqual(["/Users/x"]);
  });

  it("parses a bare path without the file:// prefix", () => {
    const detector = createOsc7Detector();
    const found = detector.push("\x1b]7;/Users/x/y\x07");
    expect(found).toEqual(["/Users/x/y"]);
  });

  it("ignores the host part of file:// URLs", () => {
    const detector = createOsc7Detector();
    const found = detector.push(
      "\x1b]7;file://192-168-1-3.tunnelmole.com-12345/Users/x/y\x07",
    );
    expect(found).toEqual(["/Users/x/y"]);
  });

  it("survives chunking mid-sequence", () => {
    const detector = createOsc7Detector();
    const out = [
      ...detector.push("\x1b]7;file://h"),
      ...detector.push("ost/Users/x/y\x07"),
    ];
    expect(out).toEqual(["/Users/x/y"]);
  });

  it("survives a chunk boundary between ESC and ]", () => {
    const detector = createOsc7Detector();
    const out = [...detector.push("\x1b"), ...detector.push("]7;/Users/x\x07")];
    expect(out).toEqual(["/Users/x"]);
  });

  it("survives a chunk boundary right before the terminator", () => {
    const detector = createOsc7Detector();
    const out = [...detector.push("\x1b]7;/Users/x"), ...detector.push("\x07")];
    expect(out).toEqual(["/Users/x"]);
  });

  it("skips OSC 0 titles without misdetecting 7; inside the title", () => {
    const detector = createOsc7Detector();
    const out = detector.push("\x1b]0;title with 7;/etc\x07");
    expect(out).toEqual([]);
  });

  it("skips colored output between two OSC 7 sequences", () => {
    const detector = createOsc7Detector();
    const out = detector.push(
      "\x1b]7;/Users/a\x07" +
        "\x1b[32mhello\x1b[0m\x1b[1mworld\x1b[0m" +
        "\x1b]7;/Users/b\x07",
    );
    expect(out).toEqual(["/Users/a", "/Users/b"]);
  });

  it("handles an ESC that is not part of a sequence", () => {
    const detector = createOsc7Detector();
    expect(detector.push("\x1b\x1b]7;/x\x07")).toEqual(["/x"]);
    expect(detector.push("plain text")).toEqual([]);
    expect(detector.push("\x1bZfoo\x07")).toEqual([]);
  });

  it("caps runaway payloads at 2048 chars", () => {
    const detector = createOsc7Detector();
    const out = detector.push("\x1b]7;" + "x".repeat(3000) + "\x07");
    expect(out).toEqual([]);
  });

  it("recovers after an ST inside a foreign OSC", () => {
    const detector = createOsc7Detector();
    const out = detector.push("\x1b]2;title\x1b\\\x1b]7;/ok\x07");
    expect(out).toEqual(["/ok"]);
  });

  it("treats ESC mid-payload followed by a non-\\ as a new escape", () => {
    const detector = createOsc7Detector();
    const out = detector.push("\x1b]7;/Users/x\x1bZ\x07");
    expect(out).toEqual([]);
  });
});
