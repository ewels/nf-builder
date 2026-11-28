import type {
  Diagnostic,
  SummaryCoverage,
  SummaryPort,
  WorkflowSummary,
} from "@nf-builder/engine";
import type { JSX } from "react";

function Ports({
  title,
  ports,
  showNone = false,
}: {
  readonly title: string;
  readonly ports: readonly SummaryPort[];
  /** Say "None" when there are no ports, rather than leave the section out. */
  readonly showNone?: boolean;
}): JSX.Element | null {
  if (ports.length === 0 && !showNone) return null;
  return (
    <section className="details-section">
      <h4>{title}</h4>
      {ports.length === 0 ? (
        <p className="details-none">None</p>
      ) : (
        <ul className="details-list">
          {ports.map((p) => (
            <li key={p.node + p.name}>
              <span className="details-port-name">{p.name}</span>{" "}
              <span className="details-type">{p.type ?? "Unknown type"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "165 of 184 statements (89%)", "All 3 statements (100%)" or "No statements" (F-405, ADR 0004). */
export function coverageText(c: SummaryCoverage): string {
  if (c.statements === 0 || c.percent === null) return "No statements";
  if (c.modelled === c.statements)
    return `All ${c.statements} statements (${c.percent}%)`;
  return `${c.modelled} of ${c.statements} statements (${c.percent}%)`;
}

/** The open workflow when nothing is selected (UX-31): take, emit, calls and registry modules. */
export function WorkflowSummaryView({
  summary,
  suggestions,
  onShowSuggestions,
}: {
  readonly summary: WorkflowSummary;
  /** The workflow's own suggestions (F-405); null while they are being found, left out when not known. */
  readonly suggestions?: readonly Diagnostic[] | null;
  readonly onShowSuggestions?: (first: Diagnostic) => void;
}): JSX.Element {
  const first = suggestions?.[0];
  return (
    <div className="details-summary">
      <h3 className="details-name">{summary.name}</h3>
      <p className="details-kind">
        {summary.path}
        {summary.typed === null ? "" : summary.typed ? " · Typed" : " · Legacy"}
      </p>
      <section
        className="details-section"
        data-coverage={`${summary.coverage.modelled}/${summary.coverage.statements}`}
      >
        <h4>Modelled</h4>
        <p className="details-note">{coverageText(summary.coverage)}</p>
      </section>
      {suggestions === undefined ? null : (
        <section className="details-section">
          <h4>Suggestions</h4>
          {suggestions === null ? (
            <p className="details-note">Checking for suggestions…</p>
          ) : first === undefined ? (
            <p className="details-note">No suggestions in this workflow</p>
          ) : (
            <p className="details-note">
              {`${plural(suggestions.length, "suggestion")} in this workflow `}
              <button
                type="button"
                className="details-show-problems"
                onClick={() => onShowSuggestions?.(first)}
              >
                Show suggestions
              </button>
            </p>
          )}
        </section>
      )}
      {summary.entry ? (
        <>
          <Ports title="Parameters" ports={summary.params} />
          <Ports title="Outputs" ports={summary.outputs} />
        </>
      ) : (
        <>
          <Ports title="Take" ports={summary.takes} showNone />
          <Ports title="Emit" ports={summary.emits} showNone />
        </>
      )}
      <section className="details-section">
        <h4>Calls</h4>
        {summary.calls.length === 0 ? (
          <p className="details-none">None</p>
        ) : (
          <ul className="details-list">
            {summary.calls.map((c) => (
              <li key={c.node}>
                <span className="details-port-name">{c.name}</span>{" "}
                <span className="details-type">{c.kindLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {summary.modules.length === 0 ? null : (
        <section className="details-section">
          <h4>Registry modules</h4>
          <ul className="details-list">
            {summary.modules.map((m) => (
              <li key={m.module}>
                <span className="details-port-name">{m.module}</span>{" "}
                <span className="details-type">{m.calls.join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
