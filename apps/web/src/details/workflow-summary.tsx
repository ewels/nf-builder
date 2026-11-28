import type {
  Diagnostic,
  SummaryCoverage,
  SummaryPort,
  WorkflowSummary,
} from "@nf-builder/engine";
import type { JSX } from "react";
import { useState } from "react";
import { plural } from "../import/import-summary";
import { PortForm } from "./port-form";

function Ports({
  title,
  ports,
  showNone = false,
  add,
}: {
  readonly title: string;
  readonly ports: readonly SummaryPort[];
  /** Say "None" when there are no ports, rather than leave the section out. */
  readonly showNone?: boolean;
  /** Adds a port of this section; left out when the workflow can't take one (F-307, UX-51). */
  readonly add?: {
    readonly role: "take" | "emit";
    readonly typed: boolean;
    readonly workflow: string;
    readonly onAdd: (
      name: string,
      type: string | null,
    ) => Promise<string | null>;
  };
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [announced, setAnnounced] = useState("");
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
      {add === undefined ? null : (
        <>
          <button
            type="button"
            className="details-add-port"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            {`Add ${add.role}`}
          </button>
          {open ? (
            <PortForm
              role={add.role}
              typed={add.typed}
              onCancel={() => setOpen(false)}
              onSubmit={async (name, type) => {
                const problem = await add.onAdd(name, type);
                if (problem === null) {
                  setOpen(false);
                  setAnnounced(`Added ${add.role} ${name} to ${add.workflow}.`);
                }
                return problem;
              }}
            />
          ) : null}
          <p className="visually-hidden" role="status" aria-live="polite">
            {announced}
          </p>
        </>
      )}
    </section>
  );
}

/** "165 of 184 statements (89%)", "All 3 statements (100%)" or "No statements" (F-405, ADR 0004). */
function coverageText(c: SummaryCoverage): string {
  if (c.percent === null) return "No statements";
  if (c.modelled === c.statements)
    return `All ${c.statements} statements (${c.percent}%)`;
  return `${c.modelled} of ${c.statements} statements (${c.percent}%)`;
}

/** The open workflow when nothing is selected (UX-31): take, emit, calls and registry modules. */
export function WorkflowSummaryView({
  summary,
  suggestions,
  onShowSuggestions,
  configPath,
  onOpenConfig,
  onAddPort,
}: {
  readonly summary: WorkflowSummary;
  /** The workflow's own suggestions (F-405); null while they are being found, left out when not known. */
  readonly suggestions?: readonly Diagnostic[] | null;
  readonly onShowSuggestions?: (first: Diagnostic) => void;
  /** The project's root `nextflow.config`, when it has one: the entry workflow's summary links it (F-601). */
  readonly configPath?: string;
  readonly onOpenConfig?: (path: string) => void;
  /**
   * Adds a take or an emit to this workflow and resolves to the refusal's message, or null (F-307, UX-51). Left out
   * read-only (F-703); the forms also stay away from the entry workflow and from a file that didn't parse.
   */
  readonly onAddPort?: (
    role: "take" | "emit",
    name: string,
    type: string | null,
  ) => Promise<string | null>;
}): JSX.Element {
  const first = suggestions?.[0];
  const addTo = (role: "take" | "emit") =>
    onAddPort === undefined || summary.typed === null
      ? undefined
      : {
          role,
          typed: summary.typed,
          workflow: summary.name,
          onAdd: (name: string, type: string | null) =>
            onAddPort(role, name, type),
        };
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
              {`${plural(suggestions.length, "suggestion", "suggestions")} in this workflow `}
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
          <Ports
            title="Take"
            ports={summary.takes}
            showNone
            add={addTo("take")}
          />
          <Ports
            title="Emit"
            ports={summary.emits}
            showNone
            add={addTo("emit")}
          />
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
