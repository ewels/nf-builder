import { installedPackVersions } from "@nf-builder/engine";
import type { JSX } from "react";
import { type CanvasContent, useWorkspace } from "./canvas/canvas-store";
import { DetailsHeader } from "./details/details-header";
import { DetailsPane } from "./details/details-pane";
import { useHistoryKeys } from "./history/use-history-keys";
import { COLLAPSED_WIDTH, useLayout } from "./layout/layout-store";
import { useProblems } from "./problems/problems-store";
import { ProjectControls } from "./project/project-controls";
import { saveLabel } from "./project/project-status";
import { useProjects } from "./project/project-store";
import { AppHeader } from "./shell/app-header";
import { ColumnSeparator } from "./shell/column-separator";
import { LeftColumn } from "./shell/left-column";
import { SideColumn } from "./shell/side-column";
import { StatusBar, type StatusProblems } from "./shell/status-bar";
import { TabStrip } from "./shell/tab-strip";
import { TabPanel } from "./views/tab-panel";
import { useViewModeKeys } from "./views/use-view-mode-keys";

const languageVersions = installedPackVersions();

/** The status bar's counts: the nodes and channels of the active canvas (UX-03). */
export function canvasCounts(content: CanvasContent): {
  nodes: number;
  channels: number;
} {
  return content.status === "ready"
    ? {
        nodes: content.projection.nodes.length,
        channels: content.projection.edges.length,
      }
    : { nodes: 0, channels: 0 };
}

/** The status bar's problems: null with no project (plain text), else the store's counts and the panel's tab. */
function useProblemsStatus(hasProject: boolean): StatusProblems | null {
  const status = useProblems((s) => s.status);
  const sections = useProblems((s) => s.sections);
  const message = useProblems((s) => s.message);
  const open = useProblems((s) => s.open);
  const view = useProblems((s) => s.view);
  const toggle = useProblems((s) => s.toggle);
  if (!hasProject) return null;
  return {
    status,
    counts: sections.counts,
    message,
    open: open ? view : null,
    onToggle: toggle,
  };
}

export function AppShell(): JSX.Element {
  useViewModeKeys();
  useHistoryKeys();
  const left = useLayout((s) => s.left);
  const right = useLayout((s) => s.right);
  const leftWidth = left.collapsed ? COLLAPSED_WIDTH : left.width;
  const content = useWorkspace((s) => s.content);
  const counts = canvasCounts(content);
  const hasProject = useWorkspace((s) => s.summary !== null);
  const diagnostics = useProblemsStatus(hasProject);
  const projects = useProjects((s) => s.status);
  const storageWarning = useProjects((s) => s.storageWarning);
  const persisted = useProjects((s) => s.persisted);
  const showDialog = useProjects((s) => s.showDialog);
  const rightWidth = right.collapsed ? COLLAPSED_WIDTH : right.width;
  return (
    <div className="app-shell">
      <AppHeader
        languageVersions={languageVersions}
        projectControls={<ProjectControls />}
        saveLabel={saveLabel(projects.current !== null, projects.save)}
        saveFailed={
          projects.save.status === "failed" ? (projects.save.error ?? "") : null
        }
        storageWarning={storageWarning}
        storageNote={persisted === false}
        onTemplates={() => showDialog({ kind: "new", route: "template" })}
      />
      <div
        className="app-columns"
        style={{
          gridTemplateColumns: `${leftWidth}px minmax(0, 1fr) ${rightWidth}px`,
        }}
      >
        <LeftColumn languageVersion={languageVersions[0]} />
        {left.collapsed ? null : (
          <ColumnSeparator side="left" label="Resize components and files" />
        )}
        <main className="column column-centre" aria-label="Canvas and editor">
          <TabStrip />
          <TabPanel />
        </main>
        {right.collapsed ? null : (
          <ColumnSeparator side="right" label="Resize details" />
        )}
        <SideColumn side="right" label="Details" header={<DetailsHeader />}>
          <DetailsPane />
        </SideColumn>
      </div>
      <StatusBar
        diagnostics={diagnostics}
        nodes={counts.nodes}
        channels={counts.channels}
        languageVersion={languageVersions[0]}
      />
    </div>
  );
}
