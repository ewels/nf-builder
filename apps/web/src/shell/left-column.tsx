import type { JSX, KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import { FilesPanel } from "../files/files-panel";
import { filesStore } from "../files/files-store";
import { useLayout } from "../layout/layout-store";
import { PalettePanel } from "../palette/palette-panel";
import { SideColumn } from "./side-column";

type LeftView = "components" | "files";
const VIEWS: readonly { readonly view: LeftView; readonly label: string }[] = [
  { view: "components", label: "Components" },
  { view: "files", label: "Files" },
];

function LeftColumnTabs({
  view,
  onChange,
}: {
  readonly view: LeftView;
  readonly onChange: (view: LeftView) => void;
}): JSX.Element {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.findIndex((v) => v.view === view);
    const last = VIEWS.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = VIEWS[targets[event.key] ?? -1];
    if (!target) return;
    event.preventDefault();
    onChange(target.view);
    document.getElementById(`left-tab-${target.view}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Left column view"
      className="left-tabs"
      onKeyDown={move}
    >
      {VIEWS.map((v) => (
        <button
          key={v.view}
          type="button"
          role="tab"
          id={`left-tab-${v.view}`}
          className="left-tab"
          aria-selected={view === v.view}
          aria-controls={`left-panel-${v.view}`}
          tabIndex={view === v.view ? 0 : -1}
          onClick={() => onChange(v.view)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function LeftColumn({
  languageVersion,
}: {
  readonly languageVersion: string | undefined;
}): JSX.Element {
  const [view, setView] = useState<LeftView>("components");
  const collapsed = useLayout((s) => s.left.collapsed);
  const noProject = useWorkspace((s) => s.summary === null);
  // the Files panel pulls its list only while it can be seen
  useEffect(() => {
    filesStore.getState().setVisible(view === "files" && !collapsed);
  }, [view, collapsed]);
  return (
    <SideColumn
      side="left"
      label="Components and files"
      header={<LeftColumnTabs view={view} onChange={setView} />}
    >
      {/* Both panels stay mounted so the query and the loaded palette survive switching. */}
      <div
        role="tabpanel"
        id="left-panel-components"
        aria-labelledby="left-tab-components"
        hidden={view !== "components"}
      >
        <PalettePanel languageVersion={languageVersion} />
      </div>
      <div
        role="tabpanel"
        id="left-panel-files"
        // only the placeholder has nothing focusable inside, so only it is a tab stop (WAI-ARIA tabs pattern)
        tabIndex={noProject ? 0 : undefined}
        aria-labelledby="left-tab-files"
        hidden={view !== "files"}
      >
        <FilesPanel />
      </div>
    </SideColumn>
  );
}
