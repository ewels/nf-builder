import type { Diagnostic } from "@nf-builder/engine";

type DiagnosticSeverity = Diagnostic["severity"];

/** The severity word and glyph shown with every problem, so colour is never the only cue (QA-12). */
export const SEVERITY_WORDS: Record<DiagnosticSeverity, string> = {
  error: "Error",
  warning: "Warning",
  suggestion: "Suggestion",
};

export const SEVERITY_GLYPHS: Record<DiagnosticSeverity, string> = {
  error: "✕",
  warning: "▲",
  suggestion: "◆",
};
