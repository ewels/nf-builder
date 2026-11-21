import type { JSX } from "react";

export const APP_NAME = "nf-builder";

export function AppShell(): JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-name">{APP_NAME}</h1>
      </header>
      <div className="app-columns">
        <aside
          className="column column-left"
          aria-label="Components and files"
        />
        <main className="column column-centre" aria-label="Canvas and editor" />
        <aside className="column column-right" aria-label="Details" />
      </div>
    </div>
  );
}
