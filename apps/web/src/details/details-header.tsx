import { popupTarget } from "@nf-builder/engine";
import { type JSX, useMemo } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import { openPopup, usePopup } from "../popup/popup-store";
import { useReadOnly } from "../read-only/read-only-store";

/** What the Edit button does: `reason` is null when it opens the popup, else why it can't (UX-32, F-303). */
export interface EditAction {
  readonly reason: string | null;
  readonly onOpen: () => void;
  /** Opens the popup on its Code tab (F-304). */
  readonly onCode?: () => void;
}

/**
 * The column heading; while a node is selected, Edit and Code beside it (UX-32). Edit opens the popup for a typed
 * process, Code opens it on the Code tab; without an `edit` action they are disabled.
 */
export function DetailsHeaderView({
  selected,
  readOnly = false,
  edit,
}: {
  readonly selected: boolean;
  /** Below 1024 px (F-703, UX-04): the popup buttons aren't offered. */
  readonly readOnly?: boolean;
  readonly edit?: EditAction;
}): JSX.Element {
  const title = <h2 className="column-title">Details</h2>;
  if (!selected || readOnly) return title;
  const canEdit = edit !== undefined && edit.reason === null;
  const canCode = canEdit && edit.onCode !== undefined;
  return (
    <div className="details-header">
      {title}
      <button
        type="button"
        className="details-action"
        data-action="edit"
        disabled={!canEdit}
        title={
          canEdit
            ? "Edit this process"
            : (edit?.reason ?? "Opens the edit popup (not available yet)")
        }
        onClick={canEdit ? edit.onOpen : undefined}
      >
        Edit
      </button>
      <button
        type="button"
        className="details-action"
        data-action="code"
        disabled={!canCode}
        title={
          canCode
            ? "Edit this process's code"
            : (edit?.reason ?? "Opens the code popup (not available yet)")
        }
        onClick={canCode ? edit.onCode : undefined}
      >
        Code
      </button>
    </div>
  );
}

export function DetailsHeader(): JSX.Element {
  const selected = useWorkspace((s) => s.selected);
  const content = useWorkspace((s) => s.content);
  const tab = useWorkspace((s) => s.activeTab);
  const readOnly = useReadOnly();
  const refusal = usePopup((s) => s.refusal);
  const edit = useMemo((): EditAction | undefined => {
    if (selected === null || tab === null || content.status !== "ready")
      return undefined;
    const node = content.projection.nodes.find((n) => n.id === selected);
    if (node === undefined) return undefined;
    const target = popupTarget(node);
    return {
      reason:
        target.kind === "typedProcess"
          ? null
          : target.kind === "workflow"
            ? "Open a workflow from its node."
            : target.reason,
      onOpen: () =>
        void openPopup({
          tab,
          node: selected,
          opener: document.querySelector<HTMLElement>('[data-action="edit"]'),
        }),
      onCode: () =>
        void openPopup({
          tab,
          node: selected,
          opener: document.querySelector<HTMLElement>('[data-action="code"]'),
          section: "code",
        }),
    };
  }, [selected, content, tab]);
  return (
    <>
      <DetailsHeaderView
        selected={selected !== null}
        readOnly={readOnly}
        edit={edit}
      />
      <p role="status" className="popup-notice">
        {refusal}
      </p>
    </>
  );
}
