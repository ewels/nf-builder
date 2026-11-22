import type { Diagnostic } from "@nf-builder/engine";
import type { JSX } from "react";

const WORDS = {
  error: "Error",
  warning: "Warning",
  suggestion: "Suggestion",
} as const;
const GLYPHS = { error: "✕", warning: "▲", suggestion: "◆" } as const;

/** A node's problems: a severity word and a glyph, so colour isn't the only cue (QA-12). */
export function DiagnosticList({
  diagnostics,
}: {
  readonly diagnostics: readonly Diagnostic[];
}): JSX.Element {
  if (diagnostics.length === 0)
    return <p className="details-none">No problems found</p>;
  return (
    <ul className="details-list">
      {diagnostics.map((d) => (
        <li
          key={`${d.path}:${d.range.start}:${d.range.end}:${d.code}:${d.message}`}
          className={`details-problem is-${d.severity}`}
        >
          <span className="details-problem-severity">
            <span aria-hidden="true">{GLYPHS[d.severity]} </span>
            {WORDS[d.severity]}
          </span>{" "}
          {d.message}
        </li>
      ))}
    </ul>
  );
}
