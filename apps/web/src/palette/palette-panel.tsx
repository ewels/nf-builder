import {
  type PaletteCategoryId,
  type PaletteView,
  paletteItemCount,
  pluginPaletteGroup,
  queryTerms,
  searchPalette,
  searchPluginGroups,
} from "@nf-builder/engine";
import { createRegistrySearch } from "@nf-builder/sources";
import { type JSX, useDeferredValue, useMemo, useState } from "react";
import { usePlugins } from "../registry/plugin-store";
import { RegistrySection } from "../registry/registry-section";
import { useRegistry } from "../registry/registry-store";
import "./palette.css";
import { PaletteHeading } from "./palette-heading";
import { PaletteMessage } from "./palette-message";
import { paletteMessage } from "./palette-message-rule";
import { PaletteSearch } from "./palette-search";
import { usePaletteStore } from "./palette-store";
import { PaletteTree } from "./palette-tree";
import { PluginGroups } from "./plugin-groups";
import { usePaletteAdd } from "./use-palette-add";
import { usePaletteView } from "./use-palette-view";

const PLUGINS_CATEGORY = "plugins-config";

/** `shown` with the category `id` of `full` added back (emptied) when the search dropped it, in `full`'s order. */
function withCategory(
  shown: PaletteView,
  full: PaletteView,
  id: PaletteCategoryId,
): PaletteView {
  if (shown.categories.some((c) => c.id === id)) return shown;
  return {
    ...shown,
    categories: full.categories.flatMap((c) =>
      c.id === id
        ? [{ ...c, items: [], groups: [] }]
        : shown.categories.filter((s) => s.id === c.id),
    ),
  };
}

export function PalettePanel({
  languageVersion,
}: {
  readonly languageVersion: string | undefined;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const { add, message: added } = usePaletteAdd();
  const open = usePaletteStore((s) => s.open);
  const toggleCategory = usePaletteStore((s) => s.toggleCategory);
  const state = usePaletteView(languageVersion);
  const view = state.status === "ready" ? state.view : undefined;
  const shown = useMemo(
    () => (view ? searchPalette(view, query) : undefined),
    [view, query],
  );
  const searching = query.trim() !== "";
  const loaded = usePlugins((s) => s.specs);
  const pluginGroups = useMemo(
    () =>
      searchPluginGroups(
        loaded.map((p) => pluginPaletteGroup(p.spec, p.version, p.approximate)),
        queryTerms(query),
      ),
    [loaded, query],
  );
  const pluginItems = pluginGroups.reduce((n, g) => n + g.items.length, 0);
  // a search drops categories with no match, but the plugin items still need theirs
  const tree = useMemo(
    () => (shown && view ? withCategory(shown, view, PLUGINS_CATEGORY) : shown),
    [shown, view],
  );
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
  const message = shown
    ? paletteMessage(
        paletteItemCount(shown) + pluginItems,
        matches ? matches.modules.length + matches.plugins.length : null,
      )
    : "none";
  return (
    <div className="palette">
      <PaletteSearch value={query} onChange={setQuery} />
      <div aria-live="polite" className="palette-add-status">
        {added}
      </div>
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
          <PaletteHeading version={shown.version} />
          <p className="registry-note">No language components match.</p>
        </section>
      ) : (
        <PaletteTree
          view={pluginItems > 0 && tree ? tree : shown}
          open={open}
          searching={searching}
          onToggle={toggleCategory}
          onAdd={(item, at) => void add(item, at)}
          extra={{
            category: PLUGINS_CATEGORY,
            node: (
              <PluginGroups
                groups={pluginGroups}
                searching={searching}
                onPress={(item) =>
                  void add({ key: item.key, label: item.name }, null)
                }
              />
            ),
          }}
        />
      )}
      <RegistrySection query={deferredQuery} matches={matches} />
    </div>
  );
}
