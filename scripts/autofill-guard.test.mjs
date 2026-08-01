// The webview must not capture secrets into Edge's autofill store.
//
// WHY THIS TEST EXISTS, because the setting it pins looks removable:
//
// The embedded WebView2 keeps its OWN autofill store, separate from the standard
// Chromium one. `autocomplete="off"` does not govern it — Tauri says so on the
// config field itself ("WebView2's autofill feature (called "Suggestions") may
// not honor `autocomplete="off"` on input elements in some cases"). A recovery
// phrase typed into an import field was found in that store in plaintext.
//
// Edge masks `type="password"` inputs and does NOT mask a textarea, so the vault
// password was protected incidentally and the phrase was not. A phrase field
// cannot be a password input: it must be multi-line and readable so the user can
// check what they pasted. So no attribute and no input type closes this. The only
// control that does is at the host: `generalAutofillEnabled: false`, which reaches
// ICoreWebView2Settings8::SetIsGeneralAutofillEnabled via tauri-runtime-wry and
// wry, whose default is ENABLED.
//
// The four attributes are kept and asserted too. They are NOT redundant: they
// govern the standard Chromium store, and that store is measurably empty, which
// is them working. Neither half is sufficient alone.
//
// ANTI-VACUITY: every assertion below is paired with one that fails if its
// subject moves or disappears, so a renamed file or a restructured config turns
// this test RED rather than silently green.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const CONFIG = resolve(root, "src-tauri/tauri.conf.json");

/** Files that put a recovery phrase into a DOM input, and the state binding that
 *  identifies the phrase field inside each. Driven from this list rather than a
 *  count, so adding a surface without adding it here is the only way to escape —
 *  and the presence check below makes a stale entry fail loudly. */
const PHRASE_INPUTS = [
  { file: "src/components/UnlockGate.tsx", binding: "resetPhrase" },
  { file: "src/components/AddVaultModal.tsx", binding: "importDraft" },
  { file: "src/components/Onboarding.tsx", binding: "importDraft" },
  { file: "src/pages/Settings.tsx", binding: "resetPhrase" },
];

const REQUIRED_ATTRS = ["autoComplete", "autoCorrect", "autoCapitalize", "spellCheck"];

/** Opening `<textarea …>` tags. JSX attribute values contain `>` (arrow
 *  functions), so brace depth is tracked rather than scanning to the first `>`. */
function textareaTags(src) {
  const tags = [];
  let i = 0;
  for (;;) {
    const start = src.indexOf("<textarea", i);
    if (start === -1) break;
    let depth = 0;
    let j = start;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(src.slice(start, j + 1));
    i = j + 1;
  }
  return tags;
}

describe("webview autofill is disabled at the host", () => {
  it("tauri.conf.json exists and still declares a window (anti-vacuity)", () => {
    expect(existsSync(CONFIG)).toBe(true);
    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    // If the config is restructured, these fail instead of the assertion below
    // passing for the wrong reason.
    expect(Array.isArray(cfg.app?.windows)).toBe(true);
    expect(cfg.app.windows.length).toBeGreaterThan(0);
    expect(cfg.app.windows[0]).toHaveProperty("title");
  });

  it("every declared window disables general autofill", () => {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    for (const [i, w] of cfg.app.windows.entries()) {
      expect(
        w.generalAutofillEnabled,
        `app.windows[${i}].generalAutofillEnabled must be false — the embedded ` +
          `webview otherwise stores typed secrets in Edge's autofill database, ` +
          `which autocomplete="off" does not govern`,
      ).toBe(false);
    }
  });
});

describe("every phrase-bearing input suppresses standard autofill", () => {
  for (const { file, binding } of PHRASE_INPUTS) {
    it(`${file} carries all four attributes on its phrase field`, () => {
      const path = resolve(root, file);
      // Anti-vacuity: a moved or renamed file must fail, not silently pass.
      expect(existsSync(path), `${file} is listed as phrase-bearing but is missing`).toBe(true);
      const src = readFileSync(path, "utf-8");

      const phraseTags = textareaTags(src).filter((t) => t.includes(binding));
      // Anti-vacuity: if the phrase field is gone or its binding renamed, the
      // filter empties and this fails rather than asserting over nothing.
      expect(
        phraseTags.length,
        `no <textarea> bound to \`${binding}\` found in ${file} — if the phrase ` +
          `field moved, update PHRASE_INPUTS rather than deleting this check`,
      ).toBeGreaterThan(0);

      for (const tag of phraseTags) {
        for (const attr of REQUIRED_ATTRS) {
          expect(tag.includes(attr), `${file}: phrase <textarea> is missing ${attr}`).toBe(true);
        }
      }
    });
  }
});
