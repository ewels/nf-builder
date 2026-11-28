// Asks once before a paste that needs new names (F-310, ADR 0039): a process already called in the workflow is included
// again under an alias, which is offered, not done silently.

import type { PasteAlias } from "@nf-builder/engine";
import { type JSX, useId } from "react";
import { useModal } from "../project/project-dialogs";

const sentence = (a: PasteAlias): string =>
  a.reason === "called"
    ? `${a.name} is already called in this workflow. It will be included again as ${a.alias}.`
    : `The name ${a.name} is already used in this file. It will be included as ${a.alias}.`;

export function PasteAliasDialog({
  aliases,
  onPaste,
  onCancel,
}: {
  readonly aliases: readonly PasteAlias[];
  readonly onPaste: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const modal = useModal(onCancel);
  const titleId = useId();
  return (
    <dialog
      ref={modal.ref}
      className="project-dialog"
      aria-labelledby={titleId}
      onClose={onCancel}
    >
      <h2 id={titleId}>Paste with new names?</h2>
      <ul>
        {aliases.map((a) => (
          <li key={a.alias}>{sentence(a)}</li>
        ))}
      </ul>
      <div className="dialog-buttons">
        <button type="button" onClick={() => modal.ref.current?.close()}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            // closing runs `onClose` (cancel) after the paste is confirmed, so the store ignores it: pendingPaste is gone
            onPaste();
            modal.ref.current?.close();
          }}
        >
          Paste
        </button>
      </div>
    </dialog>
  );
}
