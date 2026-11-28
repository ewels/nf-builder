import type { JSX, ReactNode } from "react";
import { CanvasHost } from "../canvas/canvas-host";
import { useWorkspace, type WorkflowTab } from "../canvas/canvas-store";
import { CodePane } from "../code/code-pane";
import { ConfigPane } from "../config/config-pane";
import { fileEditorOf } from "../files/file-kinds";
import { MarkdownPane } from "../markdown/markdown-pane";
import { useReadOnly } from "../read-only/read-only-store";
import { workflowTabId } from "../shell/tab-strip";
import { shownMode, type ViewMode } from "./view-mode";
import "./views.css";

/**
 * The layout of a mode (UX-27): the visual pane (the canvas, or a Markdown preview) first, then the code. The visual pane
 * keeps its position in the tree in Graph or Preview and in Split, so switching between them keeps its viewport; Code
 * unmounts it.
 */
export function PanelLayout({
  mode,
  visual,
  code,
}: {
  readonly mode: ViewMode;
  readonly visual: ReactNode;
  readonly code: ReactNode;
}): JSX.Element {
  return (
    <>
      {mode === "code" ? null : visual}
      {mode === "split" ? (
        <div className="view-divider" aria-hidden="true" />
      ) : null}
      {mode === "graph" || mode === "preview" ? null : code}
    </>
  );
}

export const READ_ONLY_FILE_NOTE =
  "This file opens in the code view on screens 1024 px or wider.";

/** What a code-only file tab shows while read-only: the code view stays unmounted below 1024 px (F-703, UX-04). */
export function ReadOnlyFileNote(): JSX.Element {
  return <p className="read-only-file-note">{READ_ONLY_FILE_NOTE}</p>;
}

/**
 * The mode a file tab shows, or null for the note. Read-only, the code view stays unmounted (F-703, UX-04), so a Markdown
 * tab shows its sanitised preview alone and any other file shows the note (F-605). A plain file is code-only otherwise.
 */
export function shownFileMode(
  tab: WorkflowTab,
  readOnly: boolean,
): ViewMode | null {
  if (fileEditorOf(tab.path) === "markdown")
    return readOnly ? "preview" : tab.mode;
  return readOnly ? null : "code";
}

/** The tab panel: the active tab's graph, code or both, by its view mode. */
export function TabPanel(): JSX.Element {
  const summary = useWorkspace((s) => s.summary);
  const session = useWorkspace((s) => s.session);
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTab));
  const readOnly = useReadOnly();
  if (summary === null || tab === undefined) return <CanvasHost />;
  const fileMode = tab.kind === "file" ? shownFileMode(tab, readOnly) : null;
  const mode =
    tab.kind === "file" ? (fileMode ?? "code") : shownMode(tab.mode, readOnly);
  const code = (
    <CodePane
      key={`code:${session}:${tab.path}`}
      path={tab.path}
      readOnly={tab.readOnly}
    />
  );
  return (
    <div
      className="tab-panel"
      id="canvas-panel"
      role="tabpanel"
      aria-labelledby={workflowTabId(tab.id)}
      data-view-mode={mode}
    >
      {(tab.kind === "file" && fileMode === null) ||
      (tab.kind === "config" && readOnly) ? (
        <ReadOnlyFileNote />
      ) : (
        <PanelLayout
          mode={mode}
          visual={
            tab.kind === "config" ? (
              <ConfigPane key={`form:${session}:${tab.path}`} path={tab.path} />
            ) : tab.kind === "file" ? (
              <MarkdownPane
                key={`preview:${session}:${tab.path}`}
                path={tab.path}
              />
            ) : (
              <CanvasHost key="canvas" />
            )
          }
          code={code}
        />
      )}
    </div>
  );
}
