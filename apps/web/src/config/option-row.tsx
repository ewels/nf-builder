// One option of a config card (F-601, FI-02, FI-03): its label, its value field and its flags.
import {
  type ConfigContext,
  type ConfigSchema,
  type ConfigSchemaNode,
  type ConfigValue,
  type ConfigValueKind,
  type OptionRow,
  valueText,
} from "@nf-builder/engine";
import { type JSX, useId, useState } from "react";
import { findSchemaNode } from "./config-details";
import type { PendingRow } from "./config-store";
import { ValueField } from "./value-field";

/** A dialog the form asks the editor to open. */
export type DialogRequest =
  | {
      readonly kind: "scope";
      readonly context: ConfigContext;
      readonly inUse: ReadonlySet<string>;
    }
  | {
      readonly kind: "option";
      readonly context: ConfigContext;
      readonly scope: ConfigSchemaNode;
      readonly taken: ReadonlySet<string>;
    }
  | { readonly kind: "selector"; readonly profile: string | null }
  | { readonly kind: "profile" }
  | { readonly kind: "plugin" }
  | {
      readonly kind: "param";
      readonly context: ConfigContext;
      readonly scope: string;
    };

/** What the form can change. Absent, or `editable` false, the form is read-only. */
export interface EditActions {
  readonly editable: boolean;
  readonly schema: ConfigSchema | null;
  readonly pending: readonly PendingRow[];
  readonly onSet: (
    context: ConfigContext,
    option: readonly string[],
    value: ConfigValue,
  ) => Promise<unknown>;
  readonly onRemove: (
    context: ConfigContext,
    option: readonly string[],
  ) => Promise<unknown>;
  readonly onRemovePlugin: (id: string) => Promise<unknown>;
  readonly onDiscard: (key: string) => void;
  readonly onEditInCode: (range: OptionRow["range"]) => void;
  readonly ask: (request: DialogRequest) => void;
}

/** What every card and row needs from the page. */
export interface ConfigHandlers {
  readonly toggled: readonly string[];
  readonly selected: string | null;
  readonly onSelect: (key: string | null) => void;
  readonly onToggle: (key: string) => void;
  readonly onOpen: (path: string) => void;
  readonly edit?: EditActions;
}

/** The text a row shows for its value: the decoded value as written, else the code, else nothing. */
const rowText = (row: OptionRow): string =>
  row.value !== null ? valueText(row.value) : (row.code ?? "");

/** The selection key of a pinned field that isn't set: its full option path. */
const unsetKey = (names: readonly string[]): string =>
  `unset:${names.join(".")}`;

export const canEdit = (handlers: ConfigHandlers): boolean =>
  handlers.edit?.editable === true;

function RowShell({
  selectKey,
  label,
  id,
  option,
  className,
  handlers,
  note,
  children,
}: {
  readonly selectKey: string;
  readonly label: string;
  readonly id: string;
  readonly option: string;
  readonly className: string;
  readonly handlers: ConfigHandlers;
  readonly note: JSX.Element | string | null;
  readonly children: JSX.Element | (JSX.Element | null)[];
}): JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field inside takes focus, which selects the row too
    <li
      className={className}
      data-option={option}
      data-selected={handlers.selected === selectKey}
      onClick={() => handlers.onSelect(selectKey)}
      onFocusCapture={() => handlers.onSelect(selectKey)}
    >
      <span className="config-row-label" id={`${id}-label`}>
        <label htmlFor={id}>{label}</label>
      </span>
      <div className="config-row-field">{children}</div>
      <span className="config-row-note" id={`${id}-note`}>
        {note}
      </span>
    </li>
  );
}

export function OptionRowView({
  row,
  context,
  pinned,
  handlers,
}: {
  readonly row: OptionRow;
  readonly context: ConfigContext;
  /** Pinned fields are cleared rather than removed (FI-02). */
  readonly pinned: boolean;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const id = useId();
  const edit = handlers.edit;
  const ok = canEdit(handlers);
  const [setting, setSetting] = useState(false);
  const unknown = row.class === "unknown";
  const asValue = row.value !== null && row.valueKind !== "code";
  const note = (
    <>
      {unknown ? (
        <span className="config-flag">
          <span aria-hidden="true">▲</span> Unknown option
        </span>
      ) : null}
      {row.occurrences > 1
        ? ` Set ${row.occurrences} times; the last one is used.`
        : ""}
    </>
  );
  const remove =
    edit !== undefined && ok && (!asValue || !pinned) ? (
      <button
        type="button"
        className="config-action"
        aria-label={`Remove ${row.option.join(".")}`}
        onClick={() => void edit.onRemove(context, row.option)}
      >
        Remove
      </button>
    ) : null;
  return (
    <RowShell
      selectKey={row.key}
      label={row.label}
      id={id}
      option={row.label}
      className="config-row"
      handlers={handlers}
      note={note}
    >
      {asValue ? (
        <ValueField
          kind={row.valueKind}
          value={row.value}
          id={id}
          describedBy={`${id}-note`}
          disabled={!ok}
          onCommit={(v) =>
            edit?.onSet(context, row.option, v) ?? Promise.resolve()
          }
          onClear={() =>
            edit?.onRemove(context, row.option) ?? Promise.resolve()
          }
        />
      ) : setting && edit !== undefined ? (
        <ValueField
          kind={row.valueKind}
          value={null}
          id={id}
          describedBy={`${id}-note`}
          onCommit={async (v) => {
            await edit.onSet(context, row.option, v);
            setSetting(false);
          }}
          onClear={async () => setSetting(false)}
        />
      ) : (
        <>
          <input
            id={id}
            className="config-row-value is-code"
            readOnly
            value={rowText(row)}
            aria-describedby={`${id}-note`}
          />
          {edit === undefined ? null : (
            <button
              type="button"
              className="config-action"
              onClick={() => edit.onEditInCode(row.range)}
            >
              Edit in code
            </button>
          )}
          {ok && !unknown && row.valueKind !== "code" ? (
            <button
              type="button"
              className="config-action"
              onClick={() => setSetting(true)}
            >
              Set a value
            </button>
          ) : null}
        </>
      )}
      {remove}
    </RowShell>
  );
}

/** A pinned field the file doesn't set (FI-02). */
export function UnsetRowView({
  label,
  names,
  context,
  handlers,
}: {
  readonly label: string;
  /** The full option path. */
  readonly names: readonly string[];
  readonly context: ConfigContext;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const id = useId();
  const edit = handlers.edit;
  return (
    <RowShell
      selectKey={unsetKey(names)}
      label={label}
      id={id}
      option={label}
      className="config-row is-unset"
      handlers={handlers}
      note={null}
    >
      <ValueField
        kind={
          findSchemaNode(edit?.schema?.scopes ?? [], names)?.valueKind ??
          "string"
        }
        value={null}
        id={id}
        disabled={!canEdit(handlers)}
        onCommit={(v) => edit?.onSet(context, names, v) ?? Promise.resolve()}
        onClear={async () => undefined}
      />
    </RowShell>
  );
}

/** A row picked in Add option or Add parameter, empty until a value is committed. */
export function PendingRowView({
  row,
  handlers,
}: {
  readonly row: PendingRow;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const id = useId();
  const edit = handlers.edit;
  const label =
    row.option.length === 1
      ? (row.option[0] as string)
      : row.option.slice(1).join(".");
  return (
    <RowShell
      selectKey={unsetKey(row.option)}
      label={label}
      id={id}
      option={label}
      className="config-row is-pending"
      handlers={handlers}
      note={null}
    >
      <ValueField
        kind={row.valueKind}
        value={null}
        id={id}
        disabled={!canEdit(handlers)}
        onCommit={(v) =>
          edit?.onSet(row.context, row.option, v) ?? Promise.resolve()
        }
        onClear={async () => undefined}
      />
      <button
        type="button"
        className="config-action"
        aria-label={`Discard ${row.option.join(".")}`}
        onClick={() => edit?.onDiscard(row.key)}
      >
        Discard
      </button>
    </RowShell>
  );
}
