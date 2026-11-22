// The project dialogs (F-202, UX-01): native <dialog> opened modally. An error shows inline and the dialog stays open.
import {
  type FormEvent,
  type JSX,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  normaliseProjectName,
  PROJECT_NAME_MAX,
} from "../workspace/project-name";
import type { ProjectMeta } from "../workspace/types";

/** Opens a dialog modally unless it already is: StrictMode mounts twice, and a cleanup `close()` would queue a `close` event after the second mount. */
export function showModalOnce(dialog: HTMLDialogElement | null): void {
  if (dialog && !dialog.open) dialog.showModal();
}

/** Opens the dialog modally on mount. `run` closes it when the action succeeds, and otherwise shows the failure inline. */
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => showModalOnce(ref.current), []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };
  return { ref, error, setError, busy, run };
}

export function ProjectNameDialog({
  mode,
  initialName,
  onSubmit,
  onClose,
}: {
  readonly mode: "create" | "rename";
  readonly initialName: string;
  readonly onSubmit: (name: string) => Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const modal = useModal(onClose);
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const title = mode === "create" ? "New project" : "Rename project";
  useEffect(() => input.current?.select(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = normaliseProjectName(input.current?.value ?? "");
    if (name === null) {
      modal.setError(`Enter a name of 1 to ${PROJECT_NAME_MAX} characters.`);
      return;
    }
    await modal.run(() => onSubmit(name));
  };

  return (
    <dialog
      ref={modal.ref}
      className="project-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <h2 id={titleId}>{title}</h2>
        <label className="dialog-field">
          <span>Name</span>
          <input
            ref={input}
            type="text"
            defaultValue={initialName}
            maxLength={PROJECT_NAME_MAX * 2}
            required
          />
        </label>
        {mode === "create" ? (
          <p className="muted">
            Projects are stored in this browser only. Clearing site data deletes
            them.
          </p>
        ) : null}
        {modal.error ? (
          <p className="dialog-error" role="alert">
            {modal.error}
          </p>
        ) : null}
        <div className="dialog-buttons">
          <button type="button" onClick={() => modal.ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={modal.busy}>
            {mode === "create" ? "Create" : "Rename"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function DeleteProjectDialog({
  project,
  onConfirm,
  onClose,
}: {
  readonly project: ProjectMeta;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const modal = useModal(onClose);
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);

  return (
    <dialog
      ref={modal.ref}
      className="project-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId}>Delete project</h2>
      <p>
        Delete “{project.name}”? Its files are removed from this browser and
        can't be recovered.
      </p>
      {modal.error ? (
        <p className="dialog-error" role="alert">
          {modal.error}
        </p>
      ) : null}
      <div className="dialog-buttons">
        <button
          type="button"
          ref={cancel}
          onClick={() => modal.ref.current?.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          disabled={modal.busy}
          onClick={() => modal.run(onConfirm)}
        >
          Delete
        </button>
      </div>
    </dialog>
  );
}
