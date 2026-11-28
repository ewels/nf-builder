import {
  paletteItemCount,
  queryTerms,
  searchPalette,
} from "@nf-builder/engine";
import { createRegistrySearch } from "@nf-builder/sources";
import { type JSX, useDeferredValue, useMemo, useState } from "react";
import { RegistrySection } from "../registry/registry-section";
import { useRegistry } from "../registry/registry-store";
import "./palette.css";
import { PaletteMessage } from "./palette-message";
import { paletteMessage } from "./palette-message-rule";
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
  const registryState = useRegistry((s) => s.state);
  const index = registryState.status === "ready" ? registryState.index : null;
  // The registry filter reads a deferred query, so a keystroke never waits for a registry re-render.
  const deferredQuery = useDeferredValue(query);
  const search = useMemo(
    () => (index ? createRegistrySearch(index) : null),
    [index],
  );
  const matches = useMemo(
    () => (search ? search(queryTerms(deferredQuery)) : null),
    [search, deferredQuery],
  );
  const genericCount = shown ? paletteItemCount(shown) : 0;
  const message = shown
    ? paletteMessage(
        genericCount,
        matches ? matches.modules.length + matches.plugins.length : null,
      )
    : "none";
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
      ) : message === "no-match" ? (
        <PaletteMessage>No components match "{query.trim()}".</PaletteMessage>
      ) : message === "no-language-match" ? (
        <section aria-labelledby="palette-heading" className="palette-tree">
          <h2 id="palette-heading" className="palette-heading">
            Nextflow language · {shown.version}
          </h2>
          <p className="registry-note">No language components match.</p>
        </section>
      ) : (
        <PaletteTree
          view={shown}
          open={open}
          searching={searching}
          onToggle={toggleCategory}
        />
      )}
      <RegistrySection query={deferredQuery} matches={matches} />
    </div>
  );
}
