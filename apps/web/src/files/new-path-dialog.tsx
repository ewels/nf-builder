// The New file and New folder dialogs of the Files view (F-210, UX-16): one Name field, checked on each keystroke
// against the project's paths, with a refusal from the engine shown inline. A native modal <dialog> with native controls
// only (QA-10, QA-11).
import { type FormEvent, type JSX, useId, useRef, useState } from "react";
import { useModal } from "../project/project-dialogs";

export function NewPathDialog({
  kind,
  folder,
  check,
  onSubmit,
  onClose,
}: {
  readonly kind: "file" | "folder";
  /** Where the new path goes: "" is the top of the project. */
  readonly folder: string;
  /** The problem with `name` in this folder, or null. */
  readonly check: (name: string) => string | null;
  /** Creates it; the refusal's message, or null when it was created. */
  readonly onSubmit: (name: string) => Promise<string | null>;
  readonly onClose: () => void;
}): JSX.Element {
  const modal = useModal(onClose);
  const titleId = useId();
  const helpId = useId();
  const problemId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const typed = name.trim() === "" ? null : check(name.trim());
  const problem = typed ?? modal.error;
  const title = kind === "file" ? "New file" : "New folder";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (value === "") {
      modal.setError("Enter a name.");
      return;
    }
    const found = check(value);
    if (found !== null) {
      modal.setError(found);
      return;
    }
    await modal.run(async () => {
      const refused = await onSubmit(value);
      if (refused !== null) throw new Error(refused);
    });
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
            value={name}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-describedby={
              problem === null ? helpId : `${helpId} ${problemId}`
            }
            aria-invalid={problem !== null}
            onChange={(event) => {
              setName(event.target.value);
              modal.setError(null);
            }}
          />
        </label>
        <p className="muted" id={helpId}>
          {folder === ""
            ? "At the top of the project."
            : `In ${folder}/. Use / to make folders on the way.`}
        </p>
        {problem === null ? null : (
          <p className="dialog-error" id={problemId} role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" onClick={() => modal.ref.current?.close()}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={modal.busy || typed !== null}
          >
            Create
          </button>
        </div>
      </form>
    </dialog>
  );
}
