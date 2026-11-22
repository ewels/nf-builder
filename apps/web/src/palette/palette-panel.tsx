import { paletteItemCount, searchPalette } from "@nf-builder/engine";
import { type JSX, useMemo, useState } from "react";
import "./palette.css";
import { PaletteMessage } from "./palette-message";
import { PaletteSearch } from "./palette-search";
import { usePaletteStore } from "./palette-store";
import { PaletteTree } from "./palette-tree";
import { usePaletteView } from "./use-palette-view";

export function PalettePanel({
  languageVersion,
}: {
  readonly languageVersion: string | undefined;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const open = usePaletteStore((s) => s.open);
  const toggleCategory = usePaletteStore((s) => s.toggleCategory);
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
          open={open}
          searching={searching}
          onToggle={toggleCategory}
        />
      )}
    </div>
  );
}
