// The form of a config file (F-601, FI-01 to FI-06): cards in source order, with the fields that edit them.
import type {
  ApplyOutcome,
  ConfigSchema,
  ConfigView,
  OptionRow,
} from "@nf-builder/engine";
import { type JSX, useState } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import { ConfigDialogs } from "./config-dialogs";
import "./config.css";
import type { PendingRow } from "./config-store";
import { useConfig } from "./config-store";
import type { ConfigHandlers, DialogRequest, EditActions } from "./option-row";
import { ConfigItems } from "./scope-card";
import { scopeItemsInUse } from "./scope-use";

export const READ_ONLY_BANNER =
  "This file has errors. Fix them in Code; the form is read-only until then.";

/** The form for a view: the banner when the file has errors, the cards, and the status line. */
export function ConfigEditorView({
  view,
  toggled,
  selected,
  notice = null,
  edit,
  onSelect,
  onToggle,
  onOpen,
}: {
  readonly view: ConfigView;
  readonly toggled: readonly string[];
  readonly selected: string | null;
  readonly notice?: string | null;
  /** What the form can change; without it every field is read-only. */
  readonly edit?: EditActions;
  readonly onSelect: (key: string | null) => void;
  readonly onToggle: (key: string) => void;
  readonly onOpen: (path: string) => void;
}): JSX.Element {
  const handlers: ConfigHandlers = {
    toggled,
    selected,
    onSelect,
    onToggle,
    onOpen,
    edit:
      edit === undefined
        ? undefined
        : { ...edit, editable: edit.editable && view.editable },
  };
  return (
    <div className="config-editor" data-editable={view.editable}>
      {view.editable ? null : (
        <p className="config-banner" role="note">
          {READ_ONLY_BANNER}
        </p>
      )}
      {edit === undefined ? null : (
        <div className="config-toolbar">
          <button
            type="button"
            className="config-add"
            disabled={!view.editable || !edit.editable}
            onClick={() =>
              edit.ask({
                kind: "scope",
                context: view.context,
                inUse: scopeItemsInUse(view.items),
              })
            }
          >
            Add scope…
          </button>
        </div>
      )}
      <p className="config-notice" role="status">
        {notice}
      </p>
      <ConfigItems items={view.items} handlers={handlers} />
    </div>
  );
}

const refusal = (outcome: ApplyOutcome | null): string | null =>
  outcome === null
    ? "No project is open."
    : outcome.ok
      ? null
      : outcome.message;

export default function ConfigEditor({
  path,
}: {
  readonly path: string;
}): JSX.Element {
  const tab = useConfig((s) => s.tabs[path]);
  const schema = useConfig((s) => s.schema);
  const store = useConfig((s) => s);
  const openFile = useWorkspace((s) => s.openFile);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  if (tab?.view == null)
    return (
      <p className="muted" role="status">
        {tab?.status === "failed"
          ? (tab.message ?? "The configuration couldn't be read.")
          : "Loading the configuration…"}
      </p>
    );
  const edit: EditActions = {
    editable: true,
    schema,
    pending: tab.pending,
    onSet: (context, option, value) => store.set(path, context, option, value),
    onRemove: (context, option) => store.remove(path, context, option),
    onRemovePlugin: (id) => store.removePlugin(path, id),
    onDiscard: (key) => store.discardPending(path, key),
    onEditInCode: (range: OptionRow["range"]) => store.editInCode(path, range),
    ask: setDialog,
  };
  return (
    <>
      <ConfigEditorView
        view={tab.view}
        toggled={tab.toggled}
        selected={tab.selected}
        notice={tab.notice}
        edit={edit}
        onSelect={(key) => store.select(path, key)}
        onToggle={(key) => store.toggle(path, key)}
        onOpen={(target) => void openFile(target)}
      />
      <ConfigDialogs
        request={dialog}
        onClose={() => setDialog(null)}
        actions={{
          schema: schema as ConfigSchema | null,
          addBlock: async (context, scope) =>
            refusal(await store.addBlock(path, context, scope)),
          addPlugin: async (id) => refusal(await store.addPlugin(path, id)),
          set: async (context, option, value) =>
            refusal(await store.set(path, context, option, value)),
          addPending: (row: PendingRow) => store.addPending(path, row),
        }}
      />
    </>
  );
}
