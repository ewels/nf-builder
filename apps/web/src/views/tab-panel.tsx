import type { JSX, ReactNode } from "react";
import { CanvasHost } from "../canvas/canvas-host";
import { useWorkspace } from "../canvas/canvas-store";
import { CodePane } from "../code/code-pane";
import { ConfigPane } from "../config/config-pane";
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

export const READ_ONLY_FILE_NOTE =
  "This file opens in the code view on screens 1024 px or wider.";

/** What a code-only file tab shows while read-only: the code view stays unmounted below 1024 px (F-703, UX-04). */
export function ReadOnlyFileNote(): JSX.Element {
  return <p className="read-only-file-note">{READ_ONLY_FILE_NOTE}</p>;
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
      {readOnly && tab.kind !== "workflow" ? (
        <ReadOnlyFileNote />
      ) : (
        <PanelLayout
          mode={mode}
          canvas={
            tab.kind === "config" ? (
              <ConfigPane key={`form:${session}:${tab.path}`} path={tab.path} />
            ) : (
              <CanvasHost key="canvas" />
            )
          }
          code={
            <CodePane
              key={`code:${session}:${tab.path}`}
              path={tab.path}
              readOnly={tab.readOnly}
            />
          }
        />
      )}
    </div>
  );
}
