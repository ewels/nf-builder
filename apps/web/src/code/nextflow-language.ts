// The Nextflow language for Monaco (F-208, ADR 0003): its id, editing rules and Shiki highlighting. Only the lazy editor
// imports this. The JavaScript regex engine means no WASM and no 'wasm-unsafe-eval' (QA-30); the grammar is the MIT
// nextflow-io/vscode-language-nextflow one and the theme is github-light, whose comments reach 4.8:1 on white (QA-13).
import { shikiToMonaco } from "@shikijs/monaco";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import nextflow from "shiki/langs/nextflow.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import { monaco, NEXTFLOW_LANGUAGE_ID } from "./monaco";

export const NEXTFLOW_THEME = "github-light";

let registered: Promise<void> | undefined;
let languageDone = false;

/**
 * Registers the language, its configuration and the highlighting once. If Shiki fails the editor still opens with plain
 * tokens, and the next mount tries the highlighting again.
 */
export function registerNextflow(): Promise<void> {
  registered ??= (async () => {
    if (!languageDone) registerLanguage();
    languageDone = true;
    try {
      const highlighter = await createHighlighterCore({
        langs: [nextflow],
        themes: [githubLight],
        engine: createJavaScriptRegexEngine(),
      });
      shikiToMonaco(
        highlighter,
        monaco as unknown as Parameters<typeof shikiToMonaco>[1],
      );
    } catch {
      registered = undefined;
    }
  })();
  return registered;
}

function registerLanguage(): void {
  monaco.languages.register({
    id: NEXTFLOW_LANGUAGE_ID,
    extensions: [".nf"],
    aliases: ["Nextflow"],
  });
  monaco.languages.setLanguageConfiguration(NEXTFLOW_LANGUAGE_ID, {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'", notIn: ["string", "comment"] },
      { open: '"', close: '"', notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
    ],
  });
}
