import { installedPackVersions } from "@nf-builder/engine";
import type { JSX } from "react";
import { type CanvasContent, useWorkspace } from "./canvas/canvas-store";
import { COLLAPSED_WIDTH, useLayout } from "./layout/layout-store";
import { ProjectControls } from "./project/project-controls";
import { saveLabel } from "./project/project-status";
import { useProjects } from "./project/project-store";
import { AppHeader } from "./shell/app-header";
import { ColumnSeparator } from "./shell/column-separator";
import { LeftColumn } from "./shell/left-column";
import { SideColumn } from "./shell/side-column";
import { StatusBar } from "./shell/status-bar";
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

export function AppShell(): JSX.Element {
  useViewModeKeys();
  const left = useLayout((s) => s.left);
  const right = useLayout((s) => s.right);
  const leftWidth = left.collapsed ? COLLAPSED_WIDTH : left.width;
  const content = useWorkspace((s) => s.content);
  const counts = canvasCounts(content);
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
        <SideColumn
          side="right"
          label="Details"
          header={<h2 className="column-title">Details</h2>}
        >
          <p className="muted">Nothing selected</p>
        </SideColumn>
      </div>
      <StatusBar
        problems={0}
        suggestions={0}
        nodes={counts.nodes}
        channels={counts.channels}
        languageVersion={languageVersions[0]}
      />
    </div>
  );
}
