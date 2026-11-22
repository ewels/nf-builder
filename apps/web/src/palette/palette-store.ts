import type { PaletteCategoryId } from "@nf-builder/engine";
import { useStore } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";
import { safeStorage } from "../layout/safe-storage";

interface PaletteState {
  /** The open categories, in palette order. */
  readonly open: readonly PaletteCategoryId[];
}
interface PaletteActions {
  toggleCategory(id: PaletteCategoryId): void;
}
type PaletteStore = PaletteState & PaletteActions;

export const PALETTE_STORAGE_KEY = "nf-builder:palette";
const PALETTE_STORAGE_VERSION = 1;
const CATEGORY_IDS: readonly PaletteCategoryId[] = [
  "processes",
  "workflows",
  "factories",
  "operators",
  "params-outputs",
  "types-functions-includes",
  "plugins-config",
];
/** First visit: Processes, Workflows and Operators are open, as in the mockup. */
export const DEFAULT_OPEN: readonly PaletteCategoryId[] = [
  "processes",
  "workflows",
  "operators",
];

const inOrder = (ids: ReadonlySet<unknown>) =>
  CATEGORY_IDS.filter((id) => ids.has(id));

/** Validates data read from storage: a bad shape gives the defaults; unknown ids are dropped. */
function sanitise(value: unknown): PaletteState {
  const open =
    typeof value === "object" && value !== null
      ? (value as { open?: unknown }).open
      : undefined;
  return Array.isArray(open)
    ? { open: inOrder(new Set(open)) }
    : { open: DEFAULT_OPEN };
}

export function createPaletteStore(
  getStorage: () => StateStorage = () => window.localStorage,
): StoreApi<PaletteStore> {
  return createStore<PaletteStore>()(
    persist(
      (set) => ({
        open: DEFAULT_OPEN,
        toggleCategory: (id) =>
          set(({ open }) => {
            const next = new Set<string>(open);
            if (!next.delete(id)) next.add(id);
            return { open: inOrder(next) };
          }),
      }),
      {
        name: PALETTE_STORAGE_KEY,
        version: PALETTE_STORAGE_VERSION,
        storage: createJSONStorage(() => safeStorage(getStorage)),
        partialize: ({ open }) => ({ open }),
        migrate: () => ({ open: DEFAULT_OPEN }),
        merge: (persisted, current) => ({
          ...current,
          ...sanitise(persisted),
        }),
      },
    ),
  );
}

const paletteStore = createPaletteStore();

export function usePaletteStore<T>(selector: (state: PaletteStore) => T): T {
  return useStore(paletteStore, selector);
}
