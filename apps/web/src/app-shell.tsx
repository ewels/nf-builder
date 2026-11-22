import { installedPackVersions } from "@nf-builder/engine";
import type { JSX } from "react";
import { COLLAPSED_WIDTH, useLayout } from "./layout/layout-store";
import { AppHeader } from "./shell/app-header";
import { ColumnSeparator } from "./shell/column-separator";
import { LeftColumn } from "./shell/left-column";
import { SideColumn } from "./shell/side-column";
import { StatusBar } from "./shell/status-bar";
import { TabStrip } from "./shell/tab-strip";

const languageVersions = installedPackVersions();

export function AppShell(): JSX.Element {
  const left = useLayout((s) => s.left);
  const right = useLayout((s) => s.right);
  const leftWidth = left.collapsed ? COLLAPSED_WIDTH : left.width;
  const rightWidth = right.collapsed ? COLLAPSED_WIDTH : right.width;
  return (
    <div className="app-shell">
      <AppHeader languageVersions={languageVersions} />
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
          <div className="canvas-area">
            <p className="muted">No project open</p>
          </div>
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
        nodes={0}
        channels={0}
        languageVersion={languageVersions[0]}
      />
    </div>
  );
}
