import {
  type PaletteCategoryId,
  paletteItemCount,
  searchPalette,
} from "@nf-builder/engine";
import { type JSX, useMemo, useState } from "react";
import "./palette.css";
import { PaletteMessage } from "./palette-message";
import { PaletteSearch } from "./palette-search";
import { PaletteTree } from "./palette-tree";
import { usePaletteView } from "./use-palette-view";

type Expanded = Readonly<Record<PaletteCategoryId, boolean>>;

/** Processes, Workflows and Operators start open, as in the mockup. Not persisted. */
const DEFAULT_EXPANDED: Expanded = {
  processes: true,
  workflows: true,
  factories: false,
  operators: true,
  "params-outputs": false,
  "types-functions-includes": false,
  "plugins-config": false,
};

export function PalettePanel({
  languageVersion,
}: {
  readonly languageVersion: string | undefined;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Expanded>(DEFAULT_EXPANDED);
  const state = usePaletteView(languageVersion);
  const view = state.status === "ready" ? state.view : undefined;
  const shown = useMemo(
    () => (view ? searchPalette(view, query) : undefined),
    [view, query],
  );
  const searching = query.trim() !== "";
  return (
    <div className="palette">
      <PaletteSearch value={query} onChange={setQuery} />
      {state.status === "error" ? (
        <PaletteMessage tone="error">
          Couldn't load the components for Nextflow {languageVersion}. Reload
          the page to try again.
        </PaletteMessage>
      ) : shown === undefined ? (
        <PaletteMessage>Loading components…</PaletteMessage>
      ) : paletteItemCount(shown) === 0 ? (
        <PaletteMessage>No components match "{query.trim()}".</PaletteMessage>
      ) : (
        <PaletteTree
          view={shown}
          expanded={expanded}
          searching={searching}
          onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
        />
      )}
    </div>
  );
}
