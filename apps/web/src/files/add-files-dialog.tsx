// The Add files dialog (F-210, UX-16, IO-12, UX-61): what a drop or an upload would add, before anything is written. It
// is always shown, names the target folder, and says plainly that adding clears the undo history (ADR 0051).
import type { AddConflict } from "@nf-builder/engine";
import { formatBytes } from "@nf-builder/sources";
import type { JSX } from "react";
import { useId } from "react";
import { plural, SkippedList } from "../import/import-summary";
import { useModal } from "../project/project-dialogs";
import type { AddFilesState, AddFilesView } from "./add-files";

const conflictText = (c: AddConflict): string =>
  c.reason === "managed"
    ? "Managed by nf-builder"
    : c.reason === "folder"
      ? "A folder has this name"
      : `${c.ancestor ?? "A parent"} is a file`;

export function AddFilesDialog({
  view,
  onClose,
}: {
  readonly view: Omit<AddFilesView, "state"> & {
    readonly state: AddFilesState & { readonly status: "ready" };
  };
  readonly onClose: () => void;
}): JSX.Element {
  const modal = useModal(onClose);
  const ids = useId();
  const { state } = view;
  const { preview, zip } = state;
  const problems = preview.summary.ignoreProblems;
  const stripped = preview.summary.stripped;
  const replaces = preview.replacedCount > 0;
  const blocked =
    preview.adds === 0 || problems.length > 0 || state.updating || state.adding;
  const target =
    preview.folder === ""
      ? "To the top of the project"
      : `To ${preview.folder}/`;
  return (
    <dialog
      ref={modal.ref}
      className="project-dialog add-files-dialog"
      aria-labelledby={`${ids}-title`}
      onClose={onClose}
    >
      <h2 id={`${ids}-title`}>
        {zip ? `Add files from ${state.name}` : "Add files"}
      </h2>
      <p>{target}</p>
      <section className="import-summary" aria-label="What would be added">
        <p>
          {plural(preview.summary.files, "file", "files")},{" "}
          {formatBytes(preview.summary.bytes)}
        </p>
        {stripped === null ? null : (
          <>
            <p className="muted">Removed the top-level folder {stripped}/.</p>
            <label className="dialog-choice">
              <input
                type="checkbox"
                checked={state.keepFolder}
                onChange={(event) => view.setKeepFolder(event.target.checked)}
              />
              <span>Keep the folder {stripped}/</span>
            </label>
          </>
        )}
        <SkippedList groups={preview.summary.skipped} />
        {replaces ? (
          <details>
            <summary>
              Replaces{" "}
              {plural(preview.replacedCount, "existing file", "existing files")}
            </summary>
            <ul className="import-paths">
              {preview.replaced.map((path) => (
                <li key={path}>{path}</li>
              ))}
              {preview.replacedCount > preview.replaced.length ? (
                <li className="muted">
                  and {preview.replacedCount - preview.replaced.length} more
                </li>
              ) : null}
            </ul>
          </details>
        ) : null}
        {preview.conflictCount > 0 ? (
          <details>
            <summary>Not added ({preview.conflictCount})</summary>
            <ul className="import-paths">
              {preview.conflicts.map((c) => (
                <li key={c.path}>
                  {c.path}: {conflictText(c)}
                </li>
              ))}
              {preview.conflictCount > preview.conflicts.length ? (
                <li className="muted">
                  and {preview.conflictCount - preview.conflicts.length} more
                </li>
              ) : null}
            </ul>
          </details>
        ) : null}
        {zip ? (
          <>
            <label className="dialog-field" htmlFor={`${ids}-ignore`}>
              Ignore list
            </label>
            <textarea
              id={`${ids}-ignore`}
              className="import-ignore"
              rows={6}
              spellCheck={false}
              value={state.ignore}
              aria-invalid={problems.length > 0}
              aria-describedby={
                problems.length > 0 ? `${ids}-problems` : undefined
              }
              onChange={(event) => view.setIgnore(event.target.value)}
            />
            {problems.length > 0 ? (
              <ul className="dialog-error" id={`${ids}-problems`}>
                {problems.map((problem) => (
                  <li key={problem.line}>
                    Line {problem.line}: {problem.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
      <p className="muted">
        Adding files can't be undone, and it clears the undo history.
      </p>
      {/* one live region that stays in the page, so its changes are announced */}
      <p className="muted" role="status">
        {state.updating ? "Updating…" : state.adding ? "Adding…" : null}
      </p>
      <div className="dialog-buttons">
        <button type="button" onClick={() => modal.ref.current?.close()}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={blocked}
          onClick={() => void view.confirm()}
        >
          {replaces
            ? "Add and replace"
            : `Add ${plural(preview.adds, "file", "files")}`}
        </button>
      </div>
    </dialog>
  );
}
