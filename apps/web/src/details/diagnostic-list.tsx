import type { Diagnostic } from "@nf-builder/engine";
import type { JSX } from "react";
import { SEVERITY_GLYPHS, SEVERITY_WORDS } from "../problems/severity";

/** A node's problems: a severity word and a glyph, so colour isn't the only cue (QA-12). */
export function DiagnosticList({
  diagnostics,
  onShowProblems,
}: {
  readonly diagnostics: readonly Diagnostic[];
  /** Opens the problems panel on the first of these (F-309); no button without it. */
  readonly onShowProblems?: (first: Diagnostic) => void;
}): JSX.Element {
  if (diagnostics.length === 0)
    return <p className="details-none">No problems found</p>;
  const first = diagnostics[0];
  return (
    <>
      <ul className="details-list">
        {diagnostics.map((d) => (
          <li
            key={`${d.path}:${d.range.start}:${d.range.end}:${d.code}:${d.message}`}
            className={`details-problem is-${d.severity}`}
          >
            <span className="details-problem-severity">
              <span aria-hidden="true">{SEVERITY_GLYPHS[d.severity]} </span>
              {SEVERITY_WORDS[d.severity]}
            </span>{" "}
            {d.message}
          </li>
        ))}
      </ul>
      {onShowProblems === undefined || first === undefined ? null : (
        <button
          type="button"
          className="details-show-problems"
          onClick={() => onShowProblems(first)}
        >
          Show in problems panel
        </button>
      )}
    </>
  );
}
