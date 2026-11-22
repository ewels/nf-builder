import type { SummaryPort, WorkflowSummary } from "@nf-builder/engine";
import type { JSX } from "react";

function Ports({
  title,
  ports,
}: {
  readonly title: string;
  readonly ports: readonly SummaryPort[];
}): JSX.Element | null {
  if (ports.length === 0) return null;
  return (
    <section className="details-section">
      <h4>{title}</h4>
      <ul className="details-list">
        {ports.map((p) => (
          <li key={p.node + p.name}>
            <span className="details-port-name">{p.name}</span>{" "}
            <span className="details-type">{p.type ?? "Unknown type"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The open workflow when nothing is selected (UX-31): take, emit, calls and registry modules. */
export function WorkflowSummaryView({
  summary,
}: {
  readonly summary: WorkflowSummary;
}): JSX.Element {
  return (
    <div className="details-summary">
      <h3 className="details-name">{summary.name}</h3>
      <p className="details-kind">
        {summary.path}
        {summary.typed === null ? "" : summary.typed ? " · Typed" : " · Legacy"}
      </p>
      <Ports title="Take" ports={summary.takes} />
      <Ports title="Emit" ports={summary.emits} />
      <Ports title="Parameters" ports={summary.params} />
      <Ports title="Outputs" ports={summary.outputs} />
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
