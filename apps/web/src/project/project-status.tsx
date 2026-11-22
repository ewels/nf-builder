// Presentational pieces of the project UI (F-202): save-state text, the storage warning and the canvas area's messages.
import type { LoadProgress } from "@nf-builder/engine";
import type { JSX } from "react";
import type { SaveState, WorkspaceStatus } from "../workspace/types";
import { type StorageUsage, storageWarningText } from "./storage-health";

export function saveLabel(hasProject: boolean, save: SaveState): string {
  if (!hasProject) return "Nothing to save";
  if (save.status === "saving") return "Saving…";
  if (save.status === "failed") return "Save failed";
  return "Saved";
}

export function formatOpening(name: string, p: LoadProgress | null): string {
  return p === null || p.total === 0
    ? `Opening ${name}`
    : `Opening ${name}: ${p.done} of ${p.total} files`;
}

export function StorageWarning({
  usage,
}: {
  readonly usage: StorageUsage;
}): JSX.Element {
  return (
    <p className="storage-warning" role="alert">
      {storageWarningText(usage)}
    </p>
  );
}

/** Shown when the browser refused persistent storage, as in a cross-origin frame (ADR 0044). Never blocks anything. */
export function PersistenceNote(): JSX.Element {
  return (
    <p className="storage-note">
      This browser may clear these projects when it needs space.
    </p>
  );
}

export function CanvasPlaceholder({
  status,
}: {
  readonly status: WorkspaceStatus;
}): JSX.Element {
  if (status.storage === "unavailable")
    return (
      <p className="muted">
        Projects can't be stored in this browser:{" "}
        {status.storageError ?? "storage is unavailable."}
      </p>
    );
  if (status.opening) {
    const { project, progress } = status.opening;
    const text = formatOpening(project.name, progress);
    return (
      <div className="opening" role="status">
        <p className="muted">{text}</p>
        {progress && progress.total > 0 ? (
          <progress
            max={progress.total}
            value={progress.done}
            aria-label={text}
          />
        ) : null}
      </div>
    );
  }
  if (status.openError)
    return (
      <p className="muted" role="alert">
        Couldn't open {status.openError.project.name}:{" "}
        {status.openError.message}
      </p>
    );
  if (status.current) return <p className="muted">No workflow open</p>;
  return <p className="muted">No project open</p>;
}
