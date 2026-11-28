// The right pane on a config tab (F-601, FI-04): the selected option's name, types, description and docs link.
import type {
  ConfigSchemaNode,
  ConfigView,
  OptionRow,
  ScopeCard,
  SelectorCard,
} from "@nf-builder/engine";
import type { JSX } from "react";
import { CatalogueText, withoutReadMore } from "./catalogue-text";
import { useConfig } from "./config-store";
import { selectorUse } from "./selector-text";

export type DetailsTarget =
  | { readonly kind: "option"; readonly row: OptionRow }
  | { readonly kind: "unset"; readonly names: readonly string[] }
  | { readonly kind: "scope"; readonly card: ScopeCard }
  | { readonly kind: "selector"; readonly card: SelectorCard };

const DOCS = "https://docs.seqera.io/nextflow/";
const CONFIG_REFERENCE = `${DOCS}reference/config`;
const SELECTOR_DOCS = `${DOCS}config#process-selectors`;

type Row = ConfigView["items"][number];

/** The row, scope card or selector card with `key`, searched through scopes, selectors and profiles. */
export function findTarget(
  view: ConfigView,
  key: string,
): DetailsTarget | null {
  if (key.startsWith("unset:"))
    return { kind: "unset", names: key.slice("unset:".length).split(".") };
  const inRows = (rows: readonly { kind: string; key: string }[]) =>
    rows.find((r) => r.key === key && r.kind === "option") as
      | OptionRow
      | undefined;
  const inItems = (items: readonly Row[]): DetailsTarget | null => {
    for (const item of items) {
      if (item.kind !== "scope") continue;
      const card = item.card;
      if (card.key === key) return { kind: "scope", card };
      const row = inRows(card.rows);
      if (row) return { kind: "option", row };
      for (const sel of card.selectors) {
        if (sel.key === key) return { kind: "selector", card: sel };
        const inSelector = inRows(sel.rows);
        if (inSelector) return { kind: "option", row: inSelector };
      }
      for (const profile of card.profiles) {
        const found = inItems(profile.items);
        if (found) return found;
      }
    }
    return null;
  };
  return inItems(view.items);
}

/** The schema node at a name path, or null. */
export function findSchemaNode(
  nodes: readonly ConfigSchemaNode[],
  names: readonly string[],
): ConfigSchemaNode | null {
  let level = nodes;
  let found: ConfigSchemaNode | null = null;
  for (const name of names) {
    found = level.find((n) => n.name === name) ?? null;
    if (found === null) return null;
    level = found.children;
  }
  return found;
}

/** The docs link of a schema node: the reference for an unknown name, none when the node says it has no page. */
const nodeDocs = (schemaNode: ConfigSchemaNode | null): JSX.Element | null =>
  schemaNode === null
    ? docsLink(CONFIG_REFERENCE)
    : schemaNode.docsUrl === null
      ? null
      : docsLink(schemaNode.docsUrl);

const docsLink = (url: string): JSX.Element => (
  <p className="config-details-docs">
    <a href={url} target="_blank" rel="noopener noreferrer">
      Open in Nextflow docs
    </a>
  </p>
);

/** What the pane shows for a target and the schema node behind it (null when there is none). */
export function ConfigDetailsView({
  target,
  schemaNode,
}: {
  readonly target: DetailsTarget | null;
  readonly schemaNode: ConfigSchemaNode | null;
}): JSX.Element {
  if (target === null)
    return <p className="muted">Select an option to see its description</p>;
  if (target.kind === "selector") {
    const { card } = target;
    return (
      <div className="config-details" data-config-details="selector">
        <h3 className="details-name">{card.written}</h3>
        <p className="details-kind">Process selector</p>
        {card.match === null ? null : (
          <section className="details-section">
            <h4>Matches</h4>
            <p className="details-file">{selectorUse(card.match)}</p>
            {card.match.processes.length === 0 ? null : (
              <ul className="details-list">
                {card.match.processes.map((p) => (
                  <li key={p}>
                    <span className="details-port-name">{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {docsLink(SELECTOR_DOCS)}
      </div>
    );
  }
  if (target.kind === "scope") {
    const { card } = target;
    const name = card.scope === "" ? "Unscoped options" : card.scope;
    return (
      <div className="config-details" data-config-details="scope">
        <h3 className="details-name">{name}</h3>
        <p className="details-kind">{card.known ? "Scope" : "Unknown scope"}</p>
        {card.known ? null : (
          <p className="details-note">
            This isn&apos;t a Nextflow 26.10 scope. Nextflow warns about its
            options when it runs; here they are kept as written.
          </p>
        )}
        {schemaNode === null ? null : (
          <CatalogueText markdown={withoutReadMore(schemaNode.description)} />
        )}
        {nodeDocs(schemaNode)}
      </div>
    );
  }
  const row = target.kind === "unset" ? null : target.row;
  const names = target.kind === "unset" ? target.names : (row?.option ?? []);
  const unknown = row?.class === "unknown";
  const types = schemaNode?.types ?? row?.types ?? [];
  return (
    <div className="config-details" data-config-details="option">
      <h3 className="details-name">{names.join(".")}</h3>
      <p className="details-kind">
        {unknown ? (
          <span className="config-flag">Unknown option</span>
        ) : types.length === 0 ? (
          "Option"
        ) : (
          types.map((t, i) => (
            <span key={t}>
              {i === 0 ? "" : " or "}
              <span className="config-type">{t}</span>
            </span>
          ))
        )}
      </p>
      {unknown ? (
        <p className="details-note">
          This isn&apos;t a Nextflow 26.10 option. Nextflow warns about it when
          it runs; here it is kept as written.
        </p>
      ) : null}
      {schemaNode === null ? null : (
        <CatalogueText markdown={withoutReadMore(schemaNode.description)} />
      )}
      {nodeDocs(schemaNode)}
    </div>
  );
}

/** The details pane of the active config tab. */
export function ConfigDetails({
  path,
}: {
  readonly path: string;
}): JSX.Element {
  const tab = useConfig((s) => s.tabs[path]);
  const schema = useConfig((s) => s.schema);
  const target =
    tab?.view == null || tab.selected === null
      ? null
      : findTarget(tab.view, tab.selected);
  const names =
    target === null
      ? null
      : target.kind === "unset"
        ? target.names
        : target.kind === "option"
          ? target.row.option
          : target.kind === "scope" && target.card.scope !== ""
            ? [target.card.scope]
            : null;
  const schemaNode =
    schema === null || names === null
      ? null
      : findSchemaNode(schema.scopes, names);
  return (
    <div className="details-pane" data-details-state="config">
      <ConfigDetailsView target={target} schemaNode={schemaNode} />
    </div>
  );
}
