// Incremental OSC 7 (cwd reporting) detector for the byte stream of a local
// terminal PTY. Shells report the working directory with
// ESC ] 7 ; file://HOST/PATH (BEL or ESC \) — the protocol VS Code and iTerm2
// parse. The state machine below survives arbitrary chunking of the stream
// by node-pty.
const ESC = 0x1b;

// Matches "file://HOST/PATH" (group 1) or a bare "/PATH" (group 2). The
// captured path always keeps its leading slash.
const OSC7_URL_RE = /^file:\/\/[^/]*(\/.*)$|^(\/.*)$/;

function createOsc7Detector() {
  // States: 0 grounded, 1 saw ESC, 2 saw ESC ], 3 collecting OSC payload,
  // 4 skip-to-terminator for a non-7 OSC sequence.
  let state = 0;
  let payload = "";
  let active = false; // the payload being collected is an OSC 7 sequence

  function reset() {
    state = 0;
    payload = "";
    active = false;
  }

  // Ends the current payload; returns the path when it was a valid OSC 7.
  function finish() {
    const out = active ? payload : null;
    reset();
    if (out) {
      const match = OSC7_URL_RE.exec(out);
      if (!match) return null;
      return match[1] ?? match[2] ?? null;
    }
    return null;
  }

  /**
   * Feeds a chunk of terminal output; returns the cwd paths reported in it
   * (zero, one or several per chunk).
   */
  function push(chunk) {
    const found = [];
    const text = typeof chunk === "string" ? chunk : String(chunk);
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code > 0xff) continue; // multi-byte runes can't be control chars
      switch (state) {
        case 0: // grounded
          if (code === ESC) state = 1;
          break;
        case 1: // saw ESC
          if (code === 0x5d) {
            // "]"
            state = 2;
          } else {
            // Anything else starts a CSI/other sequence we simply skip:
            // return to grounded unless another ESC starts right away.
            state = code === ESC ? 1 : 0;
          }
          break;
        case 2: // saw ESC ], expecting the OSC number "7;"
          if (code === 0x37) {
            // "7"
            state = 2.5;
          } else {
            // A different OSC (title etc.): skip its payload to the
            // terminator so a later "7;" inside it is not mis-parsed.
            state = 4;
          }
          break;
        case 2.5: // saw "7", expecting ";"
          if (code === 0x3b) {
            // ";"
            active = true;
            payload = "";
            state = 3;
          } else {
            state = 4;
          }
          break;
        case 3: // collecting OSC 7 payload until ST or BEL
          if (code === 0x07) {
            // BEL terminator
            const path = finish();
            if (path) found.push(path);
          } else if (code === ESC) {
            state = 5; // possible ST
          } else if (payload.length < 2048) {
            payload += ch;
          } else {
            // Path longer than anything sane: drop the sequence.
            active = false;
            state = 4;
          }
          break;
        case 5: // ESC inside OSC 7 payload
          if (code === 0x5c) {
            // "\\" — ST terminator
            const path = finish();
            if (path) found.push(path);
          } else {
            // ESC not followed by \\: treat as a new escape start.
            reset();
            state = 1;
          }
          break;
        case 4: // skipping a foreign OSC payload
          if (code === 0x07) reset();
          else if (code === ESC) state = 6;
          break;
        case 6: // ESC while skipping a foreign OSC
          if (code === 0x5c) reset();
          else if (code === ESC) state = 6;
          else state = 4;
          break;
        default:
          reset();
          break;
      }
    }
    return found;
  }

  return { push };
}

module.exports = { createOsc7Detector, OSC7_URL_RE, ESC };
