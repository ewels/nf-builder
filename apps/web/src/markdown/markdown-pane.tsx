import type { JSX } from "react";
import { lazy, Suspense, useState } from "react";
import { CanvasErrorBoundary } from "../canvas/canvas-error-boundary";
import "./markdown.css";

// The renderer, marked and DOMPurify are in this chunk only, so nothing of them loads before the first Preview or Split view (AR-32, QA-01).
const MarkdownPreview = lazy(() => import("./markdown-preview"));

/** The preview of a Markdown file (FI-30): its path, a status line and the sanitised rendering. */
export function MarkdownPane({ path }: { readonly path: string }): JSX.Element {
  const [status, setStatus] = useState("");
  return (
    <section className="markdown-pane" aria-label={`Preview pane of ${path}`}>
      <header className="markdown-pane-header">
        <span className="markdown-pane-path">{path}</span>
        <span className="markdown-pane-status" role="status">
          {status}
        </span>
      </header>
      <div className="markdown-pane-body">
        <CanvasErrorBoundary message="The preview couldn't load. Reload the page.">
          <Suspense fallback={<p className="muted">Loading preview…</p>}>
            <MarkdownPreview path={path} onStatus={setStatus} />
          </Suspense>
        </CanvasErrorBoundary>
      </div>
    </section>
  );
}
