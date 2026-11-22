import type { JSX } from "react";
import { lazy, Suspense, useState } from "react";
import "./code.css";
import type { PaneSyncState } from "./text-sync";

// The editor is in this chunk only, so nothing of it loads before the first Split or Code view (AR-32, QA-01).
const CodeEditor = lazy(() => import("./code-editor"));

/** The status line text of a sync state (empty when there is nothing to say). */
function syncText(state: PaneSyncState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "pending":
      return "Applying…";
    case "refused":
      return `Not applied: ${state.message} The graph shows the last version that parsed.`;
    case "failed":
      return state.message;
  }
}

/** The code of a workflow's file (UX-27): its path, the editor and a status line. */
export function CodePane({ path }: { readonly path: string }): JSX.Element {
  const [state, setState] = useState<PaneSyncState>({ status: "idle" });
  return (
    <section className="code-pane" aria-label={`Code of ${path}`}>
      <header className="code-pane-header">
        <span className="code-pane-path">{path}</span>
        <span
          className="code-pane-status"
          role="status"
          data-sync={state.status}
        >
          {syncText(state)}
        </span>
      </header>
      <div className="code-pane-body">
        <Suspense fallback={<p className="muted">Loading editor…</p>}>
          <CodeEditor path={path} onSync={setState} />
        </Suspense>
      </div>
    </section>
  );
}
