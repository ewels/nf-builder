import { useStore } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";

export type Side = "left" | "right";
interface ColumnLayout {
  readonly width: number;
  readonly collapsed: boolean;
}
interface LayoutState {
  readonly left: ColumnLayout;
  readonly right: ColumnLayout;
}
interface LayoutActions {
  setWidth(side: Side, width: number): void;
  setCollapsed(side: Side, collapsed: boolean): void;
  toggleCollapsed(side: Side): void;
}
type LayoutStore = LayoutState & LayoutActions;

export const LAYOUT_STORAGE_KEY = "nf-builder:layout";
const LAYOUT_STORAGE_VERSION = 1;
export const COLUMN_LIMITS: Readonly<
  Record<
    Side,
    { readonly min: number; readonly initial: number; readonly max: number }
  >
> = {
  left: { min: 200, initial: 256, max: 480 },
  right: { min: 240, initial: 296, max: 480 },
};
/** Rail that keeps the expand button. */
export const COLLAPSED_WIDTH = 32;
export const DEFAULT_LAYOUT: LayoutState = {
  left: { width: COLUMN_LIMITS.left.initial, collapsed: false },
  right: { width: COLUMN_LIMITS.right.initial, collapsed: false },
};

function clampWidth(side: Side, width: number): number {
  const { min, max } = COLUMN_LIMITS[side];
  return Math.min(max, Math.max(min, Math.round(width)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitiseColumn(side: Side, value: unknown): ColumnLayout {
  if (!isRecord(value)) return DEFAULT_LAYOUT[side];
  const { width, collapsed } = value;
  return {
    width:
      typeof width === "number" && Number.isFinite(width)
        ? clampWidth(side, width)
        : DEFAULT_LAYOUT[side].width,
    collapsed: collapsed === true,
  };
}

/** Validates data read from storage: unknown shape gives defaults; widths are clamped; non-boolean collapsed is false. */
function sanitiseLayout(value: unknown): LayoutState {
  if (!isRecord(value)) return DEFAULT_LAYOUT;
  return {
    left: sanitiseColumn("left", value.left),
    right: sanitiseColumn("right", value.right),
  };
}

/** Wraps a storage getter so that blocked, missing or full storage never throws. */
function safeStorage(getStorage: () => StateStorage): StateStorage {
  const attempt = <T>(fn: (storage: StateStorage) => T, fallback: T): T => {
    try {
      return fn(getStorage());
    } catch {
      return fallback;
    }
  };
  return {
    getItem: (name) => attempt((s) => s.getItem(name), null),
    setItem: (name, value) => attempt((s) => s.setItem(name, value), undefined),
    removeItem: (name) => attempt((s) => s.removeItem(name), undefined),
  };
}

export function createLayoutStore(
  getStorage: () => StateStorage = () => window.localStorage,
): StoreApi<LayoutStore> {
  return createStore<LayoutStore>()(
    persist(
      (set) => ({
        ...DEFAULT_LAYOUT,
        setWidth: (side, width) => {
          if (!Number.isFinite(width)) return;
          set((state) =>
            state[side].collapsed
              ? state
              : { [side]: { ...state[side], width: clampWidth(side, width) } },
          );
        },
        setCollapsed: (side, collapsed) =>
          set((state) => ({ [side]: { ...state[side], collapsed } })),
        toggleCollapsed: (side) =>
          set((state) => ({
            [side]: { ...state[side], collapsed: !state[side].collapsed },
          })),
      }),
      {
        name: LAYOUT_STORAGE_KEY,
        version: LAYOUT_STORAGE_VERSION,
        storage: createJSONStorage(() => safeStorage(getStorage)),
        partialize: ({ left, right }) => ({ left, right }),
        migrate: () => DEFAULT_LAYOUT,
        merge: (persisted, current) => ({
          ...current,
          ...sanitiseLayout(persisted),
        }),
      },
    ),
  );
}

const layoutStore = createLayoutStore();

export function useLayout<T>(selector: (state: LayoutStore) => T): T {
  return useStore(layoutStore, selector);
}
