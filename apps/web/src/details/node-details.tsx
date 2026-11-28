import type { DetailRow, Diagnostic, NodeView } from "@nf-builder/engine";
import type { JSX } from "react";
import type { DetailsContent } from "../canvas/canvas-store";
import { DetailsActions } from "./details-actions";
import { DiagnosticList } from "./diagnostic-list";
import { PortList } from "./port-list";

function Rows({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly DetailRow[];
}): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <section className="details-section">
      <h4>{title}</h4>
      <ul className="details-list">
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a directive can repeat, and rows never reorder
          <li key={i}>
            <span className="details-port-name">{r.name}</span>{" "}
            <span className="details-value">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What a selected node shows (UX-30): the projection's parts at once, the worker's once they arrive. */
export function NodeDetailsView({
  view,
  details,
  onShowProblems,
  onCopy,
  onDelete,
}: {
  readonly view: NodeView;
  /** Copy and Delete for the node, each left out where it isn't offered (F-310, ADR 0056). */
  readonly onCopy?: () => void;
  readonly onDelete?: () => void;
  readonly details: DetailsContent;
  /** Opens the problems panel on a problem of this node (F-309). */
  readonly onShowProblems?: (first: Diagnostic) => void;
}): JSX.Element {
  const ready = details.status === "ready" ? details.details : null;
  const declaration = ready?.declaration ?? null;
  const line = view.line ?? declaration?.line ?? null;
  return (
    <div className="details-node">
      <h3 className="details-name">{view.name}</h3>
      <p className="details-kind">{view.kindLabel}</p>
      <DetailsActions onCopy={onCopy} onDelete={onDelete} />
      <section className="details-section">
        <h4>File</h4>
        <p className="details-file">
          {view.path === null
            ? "Not found"
            : `${view.path}${line === null ? "" : `:${line}`}`}
        </p>
      </section>
      {declaration?.description == null ? null : (
        <p className="details-description">{declaration.description}</p>
      )}
      <PortList title="Inputs" ports={view.inputs} />
      <PortList title="Outputs" ports={view.outputs} />
      {declaration === null ? (
        <p className="details-note" role="status">
          {details.status === "unavailable"
            ? details.message
            : "Loading details…"}
        </p>
      ) : (
        <>
          <Rows title="Directives" rows={declaration.directives} />
          <Rows title="Topics" rows={declaration.topics} />
          {declaration.operators.length === 0 ? null : (
            <section className="details-section">
              <h4>Operators</h4>
              <ul className="details-list">
                {declaration.operators.map((o, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a chain can repeat an operator
                  <li key={i}>
                    <span className="details-port-name">{o.name}</span>
                    {o.legacy ? " (legacy)" : ""}
                    {o.description === null ? null : (
                      <p className="details-note">{o.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {declaration.preview === null ? null : (
            <section className="details-section">
              <h4>{declaration.preview.title}</h4>
              <pre className="details-preview">{declaration.preview.text}</pre>
              {declaration.preview.truncated ? (
                <p className="details-note">Showing the first lines only</p>
              ) : null}
            </section>
          )}
          <section className="details-section">
            <h4>Problems</h4>
            <DiagnosticList
              diagnostics={ready?.diagnostics ?? []}
              onShowProblems={onShowProblems}
            />
          </section>
        </>
      )}
    </div>
  );
}
