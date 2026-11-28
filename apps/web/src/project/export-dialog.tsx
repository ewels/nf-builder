// The Export dialog (F-404, UX-62): the zip's name and file count (the layout file only when its box is ticked), the layout checkbox (on by default, ADR 0008), warnings about
// paths that clash when unzipped (ADR 0055) and the note that files skipped at import aren't in it.
import { exportClashes } from "@nf-builder/engine";
import { exportFileName } from "@nf-builder/sources/export";
import { type JSX, useEffect, useId, useRef, useState } from "react";
import { useModal } from "./project-dialogs";

const SIDECAR = ".nf-builder/layout.json";
/** Paths listed in one warning. */
const LIST_MAX = 100;

export interface ExportDialogProps {
  readonly projectName: string;
  /** Whether the project came from a zip or GitHub, so some files may have been skipped (IO-13). */
  readonly imported: boolean;
  /** Every path in the project now. */
  readonly list: () => Promise<readonly string[]>;
  readonly onExport: (layout: boolean) => Promise<void>;
  readonly onClose: () => void;
}

const failed = (failure: unknown) =>
  `Couldn't export the project: ${failure instanceof Error ? failure.message : String(failure)}`;

const listed = (paths: readonly string[]) =>
  paths.length > LIST_MAX
    ? `${paths.slice(0, LIST_MAX).join(", ")} and ${paths.length - LIST_MAX} more`
    : paths.join(", ");

export function ExportDialog({
  projectName,
  imported,
  list,
  onExport,
  onClose,
}: ExportDialogProps): JSX.Element {
  const modal = useModal(onClose);
  const titleId = useId();
  const [paths, setPaths] = useState<readonly string[] | null>(null);
  const [layout, setLayout] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // the list is read once, when the dialog opens
  const listRef = useRef(list);
  useEffect(() => {
    let live = true;
    listRef.current().then(
      (all) => live && setPaths(all),
      (failure: unknown) => live && setLoadError(failed(failure)),
    );
    return () => {
      live = false;
    };
  }, []);

  const hasLayout = paths?.includes(SIDECAR) ?? false;
  const count = (paths?.length ?? 0) - (hasLayout && !layout ? 1 : 0);
  const clashes = exportClashes(paths ?? []);
  const run = () =>
    modal.run(async () => {
      try {
        await onExport(hasLayout && layout);
      } catch (failure) {
        throw new Error(failed(failure));
      }
    });

  return (
    <dialog
      ref={modal.ref}
      className="project-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId}>Export project</h2>
      <p>
        {exportFileName(projectName)}
        {paths === null ? null : `, ${count} ${count === 1 ? "file" : "files"}`}
      </p>
      <label className="dialog-choice">
        <input
          type="checkbox"
          checked={hasLayout && layout}
          disabled={!hasLayout}
          onChange={(event) => setLayout(event.currentTarget.checked)}
        />
        <span>Include the layout ({SIDECAR})</span>
        {paths !== null && !hasLayout ? (
          <span className="dialog-description">
            This project has no layout yet.
          </span>
        ) : null}
      </label>
      {clashes.caseOnly.map((group) => (
        <p key={group.join("\n")} className="dialog-warning">
          These paths differ only by case and clash on macOS and Windows:{" "}
          {group.join(", ")}
        </p>
      ))}
      {clashes.fileAndFolder.length > 0 ? (
        <ul className="dialog-warning-list">
          {clashes.fileAndFolder.slice(0, LIST_MAX).map((path) => (
            <li key={path} className="dialog-warning">
              {path} is both a file and a folder; some tools can't unzip both.
            </li>
          ))}
        </ul>
      ) : null}
      {clashes.fileAndFolder.length > LIST_MAX ? (
        <p className="dialog-warning">
          And {listed(clashes.fileAndFolder.slice(LIST_MAX))}.
        </p>
      ) : null}
      {imported ? (
        <p>
          Files skipped when this project was imported (binary files, for
          example) aren't in the export.
        </p>
      ) : null}
      {(modal.error ?? loadError) ? (
        <p className="dialog-error" role="alert">
          {modal.error ?? loadError}
        </p>
      ) : null}
      <div className="dialog-buttons">
        <button type="button" onClick={() => modal.ref.current?.close()}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={modal.busy || paths === null}
          onClick={run}
        >
          {modal.busy ? "Preparing the zip…" : "Export"}
        </button>
      </div>
    </dialog>
  );
}
