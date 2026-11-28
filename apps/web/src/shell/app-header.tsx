import type { JSX, ReactNode } from "react";
import {
  isFramed,
  PersistenceNote,
  StorageWarning,
} from "../project/project-status";
import type { StorageUsage } from "../project/storage-health";

const APP_NAME = "nf-builder";

interface AppHeaderProps {
  readonly languageVersions: readonly string[];
  readonly projectControls: ReactNode;
  readonly saveLabel: string;
  readonly saveFailed: string | null;
  readonly storageWarning: StorageUsage | null;
  /** True when the browser refused persistent storage. */
  readonly storageNote: boolean;
  /** Opens the New project dialog on From a template (UX-60). */
  readonly onTemplates: () => void;
  /** Below 1024 px (F-703, UX-04): no Templates, Import, Export or version selector. */
  readonly readOnly?: boolean;
}

export function AppHeader({
  languageVersions,
  projectControls,
  saveLabel,
  saveFailed,
  storageWarning,
  storageNote,
  onTemplates,
  readOnly = false,
}: AppHeaderProps): JSX.Element {
  return (
    <header className="app-header">
      <h1 className="app-name">{APP_NAME}</h1>
      {projectControls}
      <p
        className={saveFailed === null ? "save-state" : "save-state is-failed"}
        role="status"
        title={saveFailed ?? undefined}
      >
        {saveLabel}
        {saveFailed ? (
          <span className="visually-hidden">: {saveFailed}</span>
        ) : null}
      </p>
      {storageWarning ? <StorageWarning usage={storageWarning} /> : null}
      {storageNote ? <PersistenceNote framed={isFramed()} /> : null}
      {readOnly ? null : (
        <div className="header-actions">
          <button type="button" className="header-button" onClick={onTemplates}>
            Templates
          </button>
          <button type="button" className="header-button" disabled>
            Import
          </button>
          <button type="button" className="header-button" disabled>
            Export
          </button>
          <label className="version-picker">
            <span className="version-label">Nextflow</span>
            <select aria-label="Nextflow version">
              {languageVersions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </header>
  );
}
