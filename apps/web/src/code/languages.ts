// The editor languages for Monaco (F-208, F-605, ADR 0003, ADR 0048): their ids, the Nextflow editing rules and Shiki
// highlighting. Only the lazy editor imports this. The JavaScript regex engine means no WASM and no 'wasm-unsafe-eval'
// (QA-30); the Nextflow grammar is the MIT nextflow-io/vscode-language-nextflow one and the theme is github-light, whose
// comments reach 4.8:1 on white (QA-13). The other grammars load in one lazy chunk on the first file that needs one.
import { shikiToMonaco } from "@shikijs/monaco";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import nextflow from "shiki/langs/nextflow.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import type { EditorLanguage } from "../files/file-kinds";
import { monaco, NEXTFLOW_LANGUAGE_ID } from "./monaco";

export const NEXTFLOW_THEME = "github-light";

type MonacoForShiki = Parameters<typeof shikiToMonaco>[1];

let base: Promise<HighlighterCore | undefined> | undefined;
let extra: Promise<void> | undefined;
let languageDone = false;

/** The highlighter with Nextflow, made once. If Shiki fails the editor still opens with plain tokens, and the next mount tries again. */
function baseHighlighter(): Promise<HighlighterCore | undefined> {
  base ??= (async () => {
    if (!languageDone) registerNextflowLanguage();
    languageDone = true;
    try {
      const highlighter = await createHighlighterCore({
        langs: [nextflow],
        themes: [githubLight],
        engine: createJavaScriptRegexEngine(),
      });
      shikiToMonaco(highlighter, monaco as unknown as MonacoForShiki);
      return highlighter;
    } catch {
      base = undefined;
      return undefined;
    }
  })();
  return base;
}

/**
 * Makes `id` ready for a model: Nextflow and plain text need the base highlighter only. Any other language loads all
 * the extra grammars once, registers each and binds the highlighting a second and last time, which keeps Shiki's wrapper
 * chain at two (F-605). A failure leaves plain tokens and the next call tries again.
 */
export async function registerLanguage(id: EditorLanguage): Promise<void> {
  const highlighter = await baseHighlighter();
  if (highlighter === undefined) return;
  if (id === "nextflow" || id === "plaintext") return;
  extra ??= (async () => {
    try {
      const { EXTRA_GRAMMARS } = await import("./extra-grammars");
      await highlighter.loadLanguage(
        ...EXTRA_GRAMMARS.flatMap((g) => g.grammar),
      );
      for (const { id: languageId } of EXTRA_GRAMMARS)
        monaco.languages.register({ id: languageId });
      shikiToMonaco(highlighter, monaco as unknown as MonacoForShiki);
    } catch {
      extra = undefined;
    }
  })();
  return extra;
}

function registerNextflowLanguage(): void {
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
