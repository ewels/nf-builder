// The form of a config file (F-601, FI-01 to FI-06). Read-only so far: rows, cards, selector counts and include links.
import type { ConfigView } from "@nf-builder/engine";
import type { JSX } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import "./config.css";
import { useConfig } from "./config-store";
import { ConfigItems } from "./scope-card";

export const READ_ONLY_BANNER =
  "This file has errors. Fix them in Code; the form is read-only until then.";

/** The form for a view: the banner when the file has errors, then its cards in source order. */
export function ConfigEditorView({
  view,
  toggled,
  selected,
  onSelect,
  onToggle,
  onOpen,
}: {
  readonly view: ConfigView;
  readonly toggled: readonly string[];
  readonly selected: string | null;
  readonly onSelect: (key: string | null) => void;
  readonly onToggle: (key: string) => void;
  readonly onOpen: (path: string) => void;
}): JSX.Element {
  return (
    <div className="config-editor" data-editable={view.editable}>
      {view.editable ? null : (
        <p className="config-banner" role="note">
          {READ_ONLY_BANNER}
        </p>
      )}
      <ConfigItems
        items={view.items}
        handlers={{ toggled, selected, onSelect, onToggle, onOpen }}
      />
    </div>
  );
}

export default function ConfigEditor({
  path,
}: {
  readonly path: string;
}): JSX.Element {
  const tab = useConfig((s) => s.tabs[path]);
  const select = useConfig((s) => s.select);
  const toggle = useConfig((s) => s.toggle);
  const openFile = useWorkspace((s) => s.openFile);
  if (tab?.view == null)
    return (
      <p className="muted" role="status">
        {tab?.status === "failed"
          ? (tab.message ?? "The configuration couldn't be read.")
          : "Loading the configuration…"}
      </p>
    );
  return (
    <ConfigEditorView
      view={tab.view}
      toggled={tab.toggled}
      selected={tab.selected}
      onSelect={(key) => select(path, key)}
      onToggle={(key) => toggle(path, key)}
      onOpen={(target) => void openFile(target)}
    />
  );
}
