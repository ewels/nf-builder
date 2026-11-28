// The Add scope and Add option dialogs (F-601, FI-03): a native modal listing catalogue names with their descriptions,
// a filter that searches name and description, and a button per name (QA-10, QA-11).
import type { ConfigSchema, ConfigSchemaNode } from "@nf-builder/engine";
import { type JSX, useId, useState } from "react";
import { useModal } from "../project/project-dialogs";

export interface PickItem {
  /** What the list shows: a scope's name, or an option's dotted name under its scope. */
  readonly name: string;
  readonly description: string;
  readonly inUse: boolean;
  readonly node: ConfigSchemaNode;
}

/** The first paragraph of a catalogue description, on one line. */
export function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? "").replace(/\s*\n\s*/g, " ").trim();
}

/** The first sentence of a catalogue description. */
export function firstSentence(text: string): string {
  const paragraph = firstParagraph(text);
  const end = paragraph.search(/[.!?](\s|$)/);
  return end < 0 ? paragraph : paragraph.slice(0, end + 1);
}

/** Whether an item shows for a filter: its name or its description contains the text, ignoring case. */
export function matches(item: PickItem, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return (
    f === "" ||
    item.name.toLowerCase().includes(f) ||
    item.description.toLowerCase().includes(f)
  );
}

/** Every top-level scope and the `plugins` block, and the unscoped options apart, as the dialog lists them. */
export function scopeItems(
  schema: ConfigSchema,
  inUse: ReadonlySet<string>,
): { scopes: PickItem[]; unscoped: PickItem[] } {
  const item = (node: ConfigSchemaNode): PickItem => ({
    name: node.name,
    description: firstParagraph(node.description),
    inUse: inUse.has(node.name),
    node,
  });
  return {
    scopes: schema.scopes.filter((n) => n.kind !== "option").map(item),
    unscoped: schema.scopes.filter((n) => n.kind === "option").map(item),
  };
}

/** The options of a scope not yet set, nested scopes flattened as dotted names (placeholders are skipped). */
export function optionItems(
  scope: ConfigSchemaNode,
  taken: ReadonlySet<string>,
): PickItem[] {
  const out: PickItem[] = [];
  const walk = (node: ConfigSchemaNode, prefix: string[]): void => {
    for (const child of node.children) {
      const names = [...prefix, child.name];
      if (child.kind === "option") {
        const name = names.join(".");
        if (!taken.has(name))
          out.push({
            name,
            description: firstSentence(child.description),
            inUse: false,
            node: child,
          });
      } else if (child.kind === "scope") walk(child, names);
    }
  };
  walk(scope, []);
  return out;
}

function PickList({
  title,
  items,
  filter,
  onPick,
}: {
  readonly title: string | null;
  readonly items: readonly PickItem[];
  readonly filter: string;
  readonly onPick: (item: PickItem) => void;
}): JSX.Element | null {
  const shown = items.filter((i) => matches(i, filter));
  if (shown.length === 0) return null;
  return (
    <section className="config-pick-group">
      {title === null ? null : <h3>{title}</h3>}
      <ul className="config-pick-list">
        {shown.map((i) => (
          <li key={i.node.path.join(".")}>
            <button
              type="button"
              className="config-pick"
              disabled={i.inUse}
              onClick={() => onPick(i)}
            >
              <span className="config-pick-name">{i.name}</span>
              {i.inUse ? <span className="config-pick-tag">In use</span> : null}
              <span className="config-pick-description">{i.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PickDialog({
  title,
  filterLabel,
  groups,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly filterLabel: string;
  readonly groups: readonly {
    readonly title: string | null;
    readonly items: readonly PickItem[];
  }[];
  readonly onPick: (item: PickItem) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const modal = useModal(onClose);
  const titleId = useId();
  const [filter, setFilter] = useState("");
  return (
    <dialog
      ref={modal.ref}
      className="project-dialog config-pick-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      <input
        type="search"
        className="config-pick-filter"
        aria-label={filterLabel}
        placeholder="Filter"
        value={filter}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="config-pick-body">
        {groups.map((g) => (
          <PickList
            key={g.title ?? ""}
            title={g.title}
            items={g.items}
            filter={filter}
            onPick={onPick}
          />
        ))}
      </div>
      <div className="dialog-buttons">
        <button type="button" onClick={() => modal.ref.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

/** Add scope: every top-level scope, then the unscoped options. */
export function AddScopeDialog({
  schema,
  inUse,
  onPick,
  onClose,
}: {
  readonly schema: ConfigSchema;
  /** The scopes this context already has. */
  readonly inUse: ReadonlySet<string>;
  readonly onPick: (item: PickItem) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const { scopes, unscoped } = scopeItems(schema, inUse);
  return (
    <PickDialog
      title="Add scope"
      filterLabel="Filter scopes"
      groups={[
        { title: null, items: scopes },
        { title: "Unscoped options", items: unscoped },
      ]}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

/** Add option: the scope's catalogue options that aren't set yet. */
export function AddOptionDialog({
  scope,
  taken,
  onPick,
  onClose,
}: {
  readonly scope: ConfigSchemaNode;
  readonly taken: ReadonlySet<string>;
  readonly onPick: (item: PickItem) => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <PickDialog
      title={`Add option to ${scope.name}`}
      filterLabel="Filter options"
      groups={[{ title: null, items: optionItems(scope, taken) }]}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
