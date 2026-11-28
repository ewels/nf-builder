// Read-only mode below 1024 CSS px (F-703, UX-04, ADR 0003): a width media query, watched with a `change` listener so it
// agrees with CSS and measures a frame's own viewport (ADR 0044). The page's stores refuse edits while it is on.
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

const EDIT_MIN_WIDTH = 1024;
export const WIDE_QUERY = `(min-width: ${EDIT_MIN_WIDTH}px)`;
export const READ_ONLY_REFUSAL =
  "Editing needs a larger screen or a wider window.";
export const READ_ONLY_TEXT = `Read-only view: ${READ_ONLY_REFUSAL.toLowerCase()}`;

interface MediaEvent {
  readonly matches: boolean;
}

export interface MediaWatch {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (e: MediaEvent) => void): void;
  removeEventListener(type: "change", listener: (e: MediaEvent) => void): void;
}

interface ReadOnlyState {
  readonly readOnly: boolean;
}

interface ReadOnlyActions {
  /**
   * Follows the media query until the returned `stop` is called. Narrowing sends pending code edits first (`flush`),
   * then turns read-only and calls `onEnter`; widening turns it off at once.
   */
  start(options: { flush(): Promise<void>; onEnter(): void }): () => void;
}

export function createReadOnlyStore(
  media: () => MediaWatch | null,
): StoreApi<ReadOnlyState & ReadOnlyActions> {
  // read once, synchronously: the first render is already right (a phone never mounts the palette or Monaco)
  const watch = media();
  return createStore<ReadOnlyState & ReadOnlyActions>()((set) => ({
    readOnly: watch !== null && !watch.matches,

    start({ flush, onEnter }) {
      if (watch === null) return () => undefined;
      let seq = 0;
      const listener = (event: MediaEvent) => {
        const mine = ++seq;
        if (event.matches) {
          set({ readOnly: false });
          return;
        }
        void flush()
          .catch(() => undefined)
          .then(() => {
            if (mine !== seq || watch.matches) return;
            set({ readOnly: true });
            onEnter();
          });
      };
      watch.addEventListener("change", listener);
      return () => watch.removeEventListener("change", listener);
    },
  }));
}

export const readOnlyStore = createReadOnlyStore(() =>
  typeof matchMedia === "function" ? matchMedia(WIDE_QUERY) : null,
);

export function isReadOnly(): boolean {
  return readOnlyStore.getState().readOnly;
}

export function useReadOnly(): boolean {
  return useStore(readOnlyStore, (state) => state.readOnly);
}
