import type { JSX, KeyboardEvent } from "react";
import { useState } from "react";
import { PalettePanel } from "../palette/palette-panel";
import { SideColumn } from "./side-column";

export type LeftView = "components" | "files";
const VIEWS: readonly { readonly view: LeftView; readonly label: string }[] = [
  { view: "components", label: "Components" },
  { view: "files", label: "Files" },
];

export function LeftColumnTabs({
  view,
  onChange,
}: {
  readonly view: LeftView;
  readonly onChange: (view: LeftView) => void;
}): JSX.Element {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.findIndex((v) => v.view === view);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (index + VIEWS.length - 1) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? VIEWS.length - 1
              : -1;
    const target = VIEWS[next];
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
  return (
    <SideColumn
      side="left"
      label="Components and files"
      title="Components"
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
        aria-labelledby="left-tab-files"
        hidden={view !== "files"}
      >
        <p className="muted">No project open</p>
      </div>
    </SideColumn>
  );
}
