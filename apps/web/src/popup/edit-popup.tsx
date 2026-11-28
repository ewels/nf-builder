// The edit popup (F-303, F-304, UX-40, UX-41, UX-43, UX-44): a modal with a Configure tab and a Code tab. A lazily loaded
// chunk. Apply applies the draft as one undo step; Cancel discards it, and so does Esc, which asks first when the code
// draft was edited (amends ADR 0066).
import type { JSX } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { showModalOnce } from "../project/project-dialogs";
import { CodeTab } from "./code-tab";
import { ConfigureForm } from "./configure-form";
import "./popup.css";
import { canApply, popupStore, type Section, usePopup } from "./popup-store";

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
  const [showWhole, setShowWhole] = useState(false);
  // the Code tab mounts when first shown and then stays, so its model and undo stack live as long as the popup
  const [codeSeen, setCodeSeen] = useState(
    (state.status === "editing" || state.status === "applying") &&
      state.section === "code",
  );
  const section =
    state.status === "editing" || state.status === "applying"
      ? state.section
      : null;
  useEffect(() => {
    if (section === "code") setCodeSeen(true);
  }, [section]);
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
  const codeBlocked =
    state.section === "code" &&
    state.code.touched &&
    state.code.check !== "valid";
  return (
    <dialog
      ref={dialog}
      className="edit-popup"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (applying) return;
        if (state.discarding) actions.keepEditing();
        else actions.requestClose();
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
        <div
          role="tablist"
          aria-label="Edit sections"
          className="popup-tabs"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next: Section =
              state.section === "configure" ? "code" : "configure";
            void actions.showSection(next);
            document.getElementById(`${titleId}-${next}`)?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id={`${titleId}-configure`}
            aria-selected={state.section === "configure"}
            aria-controls={`${titleId}-configure-panel`}
            aria-disabled={codeBlocked || undefined}
            title={
              codeBlocked
                ? `Fix the code first: ${state.code.message ?? ""}`
                : undefined
            }
            tabIndex={state.section === "configure" ? 0 : -1}
            onClick={() => void actions.showSection("configure")}
          >
            Configure
          </button>
          <button
            type="button"
            role="tab"
            id={`${titleId}-code`}
            aria-selected={state.section === "code"}
            aria-controls={`${titleId}-code-panel`}
            tabIndex={state.section === "code" ? 0 : -1}
            onClick={() => void actions.showSection("code")}
          >
            Code
          </button>
        </div>
        {state.target.path.startsWith("modules/nf-core/") ? (
          <p className="popup-note">{REGISTRY_NOTE}</p>
        ) : null}
        <div
          role="tabpanel"
          id={`${titleId}-configure-panel`}
          aria-labelledby={`${titleId}-configure`}
          className="popup-panel"
          hidden={state.section !== "configure"}
        >
          <ConfigureForm
            draft={state.draft}
            choices={state.choices}
            fields={state.fields}
            disabled={applying}
            onChange={(change) => actions.updateDraft(change)}
          />
        </div>
        <div
          role="tabpanel"
          id={`${titleId}-code-panel`}
          aria-labelledby={`${titleId}-code`}
          className="popup-panel"
          hidden={state.section !== "code"}
        >
          {codeSeen ? (
            <CodeTab
              path={state.target.path}
              name={state.target.name}
              text={state.code.text}
              span={state.span}
              check={state.code.check}
              problems={state.code.problems}
              message={state.code.message}
              showWhole={showWhole}
              onToggleWhole={() => setShowWhole((on) => !on)}
              onChange={(text) => actions.editCode(text)}
              onFormat={() => void actions.formatCode()}
            />
          ) : null}
        </div>
        <p role="status" className="popup-message">
          {state.message}
        </p>
        {state.discarding ? (
          <div role="alert" className="popup-discard">
            <p>Discard your changes to the code?</p>
            <button type="button" onClick={() => actions.keepEditing()}>
              Keep editing
            </button>
            <button type="button" onClick={() => actions.closePopup()}>
              Discard
            </button>
          </div>
        ) : null}
        <div className="dialog-buttons popup-actions">
          <button
            type="button"
            onClick={() => actions.closePopup()}
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={applying || !canApply(state)}
          >
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
