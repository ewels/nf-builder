import type { JSX } from "react";
import { lazy, Suspense } from "react";
import { CanvasErrorBoundary } from "../canvas/canvas-error-boundary";
import { useConfig } from "./config-store";

// The form is in this chunk only, so nothing of it loads before the first config tab (AR-32, QA-01).
const ConfigEditor = lazy(() => import("./config-editor"));

/** The form of a config file in the canvas slot of a config tab (UX-27): its path and the editor. */
export function ConfigPane({ path }: { readonly path: string }): JSX.Element {
  const status = useConfig((s) => s.tabs[path]?.status ?? "loading");
  return (
    <section
      className="config-pane"
      aria-label={`Configuration of ${path}`}
      data-config-state={status}
    >
      <CanvasErrorBoundary message="The configuration form couldn't load. Reload the page.">
        <Suspense fallback={<p className="muted">Loading the form…</p>}>
          <ConfigEditor path={path} />
        </Suspense>
      </CanvasErrorBoundary>
    </section>
  );
}
