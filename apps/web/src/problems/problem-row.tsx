import type { Diagnostic } from "@nf-builder/engine";
import type { JSX } from "react";
import { SEVERITY_GLYPHS, SEVERITY_WORDS } from "./severity";

/**
 * One problem: a button that goes to it (severity, message, line and column, code) and, when the problem is fixable, a
 * button that applies its quick fix. `index` is the row's place in the list, for the panel's focus handling.
 */
export function ProblemRow({
  diagnostic: d,
  index,
  tabIndexGo,
  tabIndexFix,
  applying,
  onGo,
  onFix,
  onFocusPart,
}: {
  readonly diagnostic: Diagnostic;
  readonly index: number;
  readonly tabIndexGo: 0 | -1;
  readonly tabIndexFix: 0 | -1;
  readonly applying: boolean;
  readonly onGo: () => void;
  readonly onFix: () => void;
  readonly onFocusPart: (part: "go" | "fix") => void;
}): JSX.Element {
  return (
    <li className={`problem-row is-${d.severity}`}>
      <button
        type="button"
        className="problem-go"
        data-problem-index={index}
        data-part="go"
        tabIndex={tabIndexGo}
        onClick={onGo}
        onFocus={() => onFocusPart("go")}
      >
        <span className="problem-severity">
          <span aria-hidden="true">{SEVERITY_GLYPHS[d.severity]} </span>
          {SEVERITY_WORDS[d.severity]}
        </span>
        <span className="problem-message">{d.message}</span>
        <span
          className="problem-location"
          title={`Line ${d.range.line}, column ${d.range.column}`}
        >
          {d.range.line}:{d.range.column}
        </span>
        <span className="problem-code">{d.code}</span>
      </button>
      {d.fix === undefined ? null : (
        <button
          type="button"
          className="problem-fix"
          data-problem-index={index}
          data-part="fix"
          tabIndex={tabIndexFix}
          disabled={applying}
          onClick={onFix}
          onFocus={() => onFocusPart("fix")}
        >
          {d.fix.title}
        </button>
      )}
    </li>
  );
}
