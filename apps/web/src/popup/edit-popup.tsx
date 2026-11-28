// The edit popup (F-303, UX-40, UX-41, UX-44): a modal with a Configure tab and a Code tab that is disabled until F-304.
// A lazily loaded chunk. Apply applies the draft as one undo step; Cancel and Esc discard it.
import type { JSX } from "react";
import { useEffect, useId, useRef } from "react";
import { showModalOnce } from "../project/project-dialogs";
import { ConfigureForm } from "./configure-form";
import "./popup.css";
import { popupStore, usePopup } from "./popup-store";

const CODE_TAB_TITLE = "The Code tab arrives with the declaration editor.";
const REGISTRY_NOTE =
  "This is a registry module. Editing it here means an update will overwrite your changes.";

export default function EditPopup(): JSX.Element | null {
  const status = usePopup((s) => s.status);
  return status === "editing" || status === "applying" ? <PopupDialog /> : null;
}

function PopupDialog(): JSX.Element | null {
  const state = usePopup((s) => s);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = state.status === "closed" ? null : state.opener;
  const node = state.status === "closed" ? null : state.node;
  useEffect(() => showModalOnce(dialog.current), []);
  // the focus goes back to what opened the popup, or to its node if that was replaced
  useEffect(
    () => () => {
      const back =
        opener?.isConnected === true
          ? opener
          : document.querySelector<HTMLElement>(
              `.react-flow__node[data-id="${CSS.escape(node ?? "")}"]`,
            );
      back?.focus();
    },
    [opener, node],
  );
  if (state.status !== "editing" && state.status !== "applying") return null;
  const applying = state.status === "applying";
  const actions = popupStore.getState();
  return (
    <dialog
      ref={dialog}
      className="edit-popup"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!applying) actions.closePopup();
      }}
      onClose={() => actions.closePopup()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.applyPopup();
        }}
      >
        <h2 id={titleId}>{`Edit process ${state.target.name}`}</h2>
        <div role="tablist" aria-label="Edit sections" className="popup-tabs">
          <button
            type="button"
            role="tab"
            id={`${titleId}-configure`}
            aria-selected="true"
            aria-controls={`${titleId}-panel`}
          >
            Configure
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            title={CODE_TAB_TITLE}
            tabIndex={-1}
          >
            Code
          </button>
        </div>
        {state.target.path.startsWith("modules/nf-core/") ? (
          <p className="popup-note">{REGISTRY_NOTE}</p>
        ) : null}
        <div
          role="tabpanel"
          id={`${titleId}-panel`}
          aria-labelledby={`${titleId}-configure`}
          className="popup-panel"
        >
          <ConfigureForm
            draft={state.draft}
            choices={state.choices}
            fields={state.fields}
            disabled={applying}
            onChange={(change) => actions.updateDraft(change)}
          />
        </div>
        <p role="status" className="popup-message">
          {state.message}
        </p>
        <div className="dialog-buttons popup-actions">
          <button
            type="button"
            onClick={() => actions.closePopup()}
            disabled={applying}
          >
            Cancel
          </button>
          <button type="submit" className="primary" disabled={applying}>
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
