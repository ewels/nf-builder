// Adding a palette item to the canvas, and what to tell the user about it (F-301, UX-15, QA-11). The message is shared,
// so a drop on the canvas and a key press on a palette item reach the same live region.
import { type Point, paletteAction } from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { canvasStore } from "../canvas/canvas-store";
import { filesStore } from "../files/files-store";

export interface AddedItem {
  readonly key: string;
  readonly label?: string;
}

const messages = createStore<{ message: string | null }>()(() => ({
  message: null,
}));
const say = (message: string): void => messages.setState({ message });

/** Adds `item` to the active workflow tab with its centre at `at` (a flow point), or lets the layout place it. */
export async function paletteAdd(
  item: AddedItem,
  at: Point | null,
): Promise<void> {
  if (paletteAction(item) === null) {
    say(`${item.label ?? item.key} can't be added from the palette yet.`);
    return;
  }
  const state = canvasStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTab);
  const outcome = await state.addFromPalette(
    { item: item.key, tab: state.activeTab ?? "", at },
    state.session,
  );
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
