import type { JSX } from "react";

const APP_NAME = "nf-builder";

interface AppHeaderProps {
  readonly languageVersions: readonly string[];
}

export function AppHeader({ languageVersions }: AppHeaderProps): JSX.Element {
  return (
    <header className="app-header">
      <h1 className="app-name">{APP_NAME}</h1>
      <button
        type="button"
        className="header-button"
        aria-haspopup="menu"
        disabled
      >
        No project
      </button>
      <p className="save-state" role="status">
        Nothing to save
      </p>
      <div className="header-actions">
        <button type="button" className="header-button" disabled>
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
    </header>
  );
}
