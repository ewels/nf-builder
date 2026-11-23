import type { PortDetail } from "@nf-builder/engine";
import type { JSX } from "react";

const NOTHING = {
  "not-connected": "Not connected",
  unused: "Not used",
} as const;

function Note({ port }: { readonly port: PortDetail }): JSX.Element | null {
  if (port.unconnected === null) return null;
  if (port.unconnected === "inline")
    return (
      <p className="details-note">
        Inline argument
        {port.argumentType === null ? "" : ` (${port.argumentType})`}
      </p>
    );
  return <p className="details-note">{NOTHING[port.unconnected]}</p>;
}

/** The inputs or outputs of a node: each port's name, type and connections (UX-30). */
export function PortList({
  title,
  ports,
}: {
  readonly title: string;
  readonly ports: readonly PortDetail[];
}): JSX.Element {
  return (
    <section className="details-section">
      <h4>{title}</h4>
      {ports.length === 0 ? (
        <p className="details-none">None</p>
      ) : (
        <ul className="details-list">
          {ports.map((p) => (
            <li key={p.id}>
              <span className="details-port-name">{p.label}</span>{" "}
              <span className="details-type">{p.type ?? "Unknown type"}</span>
              {p.connections.length === 0 ? null : (
                <ul className="details-connections">
                  {p.connections.map((c) => (
                    <li key={`${c.node}:${c.text}`}>{c.text}</li>
                  ))}
                </ul>
              )}
              <Note port={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
