import type { JSX, ReactNode } from "react";
import { CanvasHost } from "../canvas/canvas-host";
import { useWorkspace } from "../canvas/canvas-store";
import { CodePane } from "../code/code-pane";
import { useReadOnly } from "../read-only/read-only-store";
import { workflowTabId } from "../shell/tab-strip";
import { shownMode, type ViewMode } from "./view-mode";
import "./views.css";

/**
 * The layout of a mode (UX-27): the canvas first, then the code. The canvas keeps its position in the tree in Graph and
 * Split, so switching between them keeps its viewport; Code unmounts it.
 */
export function PanelLayout({
  mode,
  canvas,
  code,
}: {
  readonly mode: ViewMode;
  readonly canvas: ReactNode;
  readonly code: ReactNode;
}): JSX.Element {
  return (
    <>
      {mode === "code" ? null : canvas}
      {mode === "split" ? (
        <div className="view-divider" aria-hidden="true" />
      ) : null}
      {mode === "graph" ? null : code}
    </>
  );
}

/** The tab panel: the active tab's graph, code or both, by its view mode. */
export function TabPanel(): JSX.Element {
  const summary = useWorkspace((s) => s.summary);
  const session = useWorkspace((s) => s.session);
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTab));
  const readOnly = useReadOnly();
  if (summary === null || tab === undefined) return <CanvasHost />;
  const mode = shownMode(tab.mode, readOnly);
  return (
    <div
      className="tab-panel"
      id="canvas-panel"
      role="tabpanel"
      aria-labelledby={workflowTabId(tab.id)}
      data-view-mode={mode}
    >
      <PanelLayout
        mode={mode}
        canvas={<CanvasHost key="canvas" />}
        code={<CodePane key={`code:${session}:${tab.path}`} path={tab.path} />}
      />
    </div>
  );
}
