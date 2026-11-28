// Adding a palette item to the canvas, and what to tell the user about it (F-301, UX-15, QA-11). The message is shared,
// so a drop on the canvas and a key press on a palette item reach the same live region.
import { type Point, paletteAction } from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { canvasStore } from "../canvas/canvas-store";
import { filesStore } from "../files/files-store";
import { pluginStore } from "../registry/plugin-store";
import { REGISTRY_PLUGIN_KEY } from "../registry/registry-lists";
import { registryStore } from "../registry/registry-store";

interface AddedItem {
  readonly key: string;
  readonly label?: string;
}

const messages = createStore<{ message: string | null }>()(() => ({
  message: null,
}));
// the same text again is a change a screen reader announces only when it differs, so a trailing no-break space alternates
const say = (message: string): void =>
  messages.setState((s) => ({
    message: s.message === message ? `${message}\u00A0` : message,
  }));

/** What the live region says now. */
export const paletteAddMessage = (): string | null =>
  messages.getState().message;

/** Adds a registry plugin to `nextflow.config` at the snapshot's release, and says so (F-505, IO-33, UX-15, QA-11). */
export async function addRegistryPlugin(id: string): Promise<void> {
  const registry = registryStore.getState().state;
  const listed =
    registry.status === "ready"
      ? registry.index.plugins.find((p) => p.id === id)
      : undefined;
  if (listed === undefined) {
    say(`Couldn't add ${id}: the registry isn't loaded. Nothing was changed.`);
    return;
  }
  if (pluginStore.getState().declared.some((p) => p.id === id)) {
    say(`${id} is already in nextflow.config.`);
    return;
  }
  const outcome = await canvasStore
    .getState()
    .addPlugin({ id, version: listed.version });
  say(
    outcome.ok
      ? `Added plugin ${id}@${outcome.version} to nextflow.config.`
      : outcome.message,
  );
}

/** Adds `item` to the active workflow tab with its centre at `at` (a flow point), or lets the layout place it. */
export async function paletteAdd(
  item: AddedItem,
  at: Point | null,
): Promise<void> {
  if (item.key.startsWith(REGISTRY_PLUGIN_KEY)) {
    await addRegistryPlugin(item.key.slice(REGISTRY_PLUGIN_KEY.length));
    return;
  }
  if (paletteAction(item) === null) {
    say(`${item.label ?? item.key} can't be added from the palette yet.`);
    return;
  }
  const state = canvasStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTab);
  const outcome = await state.addFromPalette({
    item: item.key,
    tab: state.activeTab ?? "",
    at,
  });
  if (!outcome.ok) {
    say(outcome.message);
    return;
  }
  filesStore.getState().reveal(outcome.path);
  const where =
    tab?.workflow == null ? "the entry workflow" : `workflow ${tab.workflow}`;
  say(`Added ${item.key} ${outcome.name} to ${where}.`);
}

export function usePaletteAdd(): {
  add: typeof paletteAdd;
  message: string | null;
} {
  return {
    add: paletteAdd,
    message: useStore(messages, (s) => s.message),
  };
}
