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

function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return { ref, onClose };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = mode === "create" ? "New project" : "Rename project";
  useEffect(() => input.current?.select(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = normaliseProjectName(input.current?.value ?? "");
    if (name === null) {
      setError(`Enter a name of 1 to ${PROJECT_NAME_MAX} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
      onClose();
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
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
          <p className="muted">Projects are stored in this browser only.</p>
        ) : null}
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-buttons">
          <button type="button" onClick={() => modal.ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => cancel.current?.focus(), []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  };

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
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
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
          disabled={busy}
          onClick={confirm}
        >
          Delete
        </button>
      </div>
    </dialog>
  );
}
