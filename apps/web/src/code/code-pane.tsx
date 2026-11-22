import type { JSX } from "react";
import { lazy, Suspense } from "react";
import "./code.css";

// The editor is in this chunk only, so nothing of it loads before the first Split or Code view (AR-32, QA-01).
const CodeEditor = lazy(() => import("./code-editor"));

/** The code of a workflow's file (UX-27): its path, the editor and a status line. */
export function CodePane({ path }: { readonly path: string }): JSX.Element {
  return (
    <section className="code-pane" aria-label={`Code of ${path}`}>
      <header className="code-pane-header">
        <span className="code-pane-path">{path}</span>
        <span className="code-pane-status" role="status" data-sync="idle" />
      </header>
      <div className="code-pane-body">
        <Suspense fallback={<p className="muted">Loading editor…</p>}>
          <CodeEditor path={path} />
        </Suspense>
      </div>
    </section>
  );
}
