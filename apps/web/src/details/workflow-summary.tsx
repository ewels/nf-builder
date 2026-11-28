import type { SummaryPort, WorkflowSummary } from "@nf-builder/engine";
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

/** The open workflow when nothing is selected (UX-31): take, emit, calls and registry modules. */
export function WorkflowSummaryView({
  summary,
  configPath,
  onOpenConfig,
}: {
  readonly summary: WorkflowSummary;
  /** The project's root `nextflow.config`, when it has one: the entry workflow's summary links it (F-601). */
  readonly configPath?: string;
  readonly onOpenConfig?: (path: string) => void;
}): JSX.Element {
  return (
    <div className="details-summary">
      <h3 className="details-name">{summary.name}</h3>
      <p className="details-kind">
        {summary.path}
        {summary.typed === null ? "" : summary.typed ? " · Typed" : " · Legacy"}
      </p>
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
      {summary.entry && configPath !== undefined ? (
        <section className="details-section">
          <h4>Configuration</h4>
          <button
            type="button"
            className="config-link"
            onClick={() => onOpenConfig?.(configPath)}
          >
            Open {configPath}
          </button>
        </section>
      ) : null}
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
