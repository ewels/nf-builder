import {
  createRegistryClient,
  LIVE_REGISTRY,
  type RegistryClient,
  type RegistryFailure,
  type RegistryIndex,
  type RegistryReadOptions,
  toFailure,
} from "@nf-builder/sources";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export type RegistryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly index: RegistryIndex;
      readonly refreshing: boolean;
      readonly refreshFailure: RegistryFailure | null;
    }
  | {
      readonly status: "failed";
      readonly failure: RegistryFailure;
      readonly refreshing: boolean;
    };

export interface RegistryStore {
  readonly state: RegistryState;
  /** No-op unless idle (StrictMode calls effects twice). */
  load(): void;
  /** Keeps the current index while refreshing and on failure. From "failed", it retries. */
  refresh(): void;
  /** Test hook: a new client with `live`, then a fresh read. */
  reload(options: { readonly live: boolean }): Promise<void>;
}

export function createRegistryStore(
  makeClient: (live: boolean) => RegistryClient,
): StoreApi<RegistryStore> {
  let client: RegistryClient | null = null;
  /** Bumped by reload, so a read that started before it is ignored. */
  let generation = 0;

  return createStore<RegistryStore>()((set, get) => {
    const setState = (state: RegistryState) => set({ state });
    const failed = (failure: RegistryFailure): RegistryState => ({
      status: "failed",
      failure,
      refreshing: false,
    });

    /** Reads the index; `onFailure` gives the state a failed read leaves. */
    async function read(
      options: RegistryReadOptions | undefined,
      onFailure: (failure: RegistryFailure) => RegistryState,
    ): Promise<void> {
      const mine = generation;
      client ??= makeClient(LIVE_REGISTRY);
      try {
        const index = await client.index(options);
        if (mine !== generation) return;
        setState({
          status: "ready",
          index,
          refreshing: false,
          refreshFailure: null,
        });
      } catch (error) {
        if (mine !== generation) return;
        setState(onFailure(toFailure(error)));
      }
    }

    return {
      state: { status: "idle" },
      load() {
        if (get().state.status !== "idle") return;
        setState({ status: "loading" });
        void read(undefined, failed);
      },
      refresh() {
        const state = get().state;
        if (state.status !== "ready" && state.status !== "failed") return;
        if (state.refreshing) return;
        setState({ ...state, refreshing: true });
        void read({ refresh: true }, (failure) =>
          state.status === "ready"
            ? { ...state, refreshing: false, refreshFailure: failure }
            : failed(failure),
        );
      },
      async reload({ live }) {
        generation++;
        client = makeClient(live);
        setState({ status: "loading" });
        await read(undefined, failed);
      },
    };
  });
}

/** The app's client: the snapshot under BASE_URL; live only through the test hook or when LIVE_REGISTRY is on. */
export const registryStore = createRegistryStore((live) =>
  createRegistryClient({
    snapshotUrl: new URL(
      `${import.meta.env.BASE_URL}registry/`,
      window.location.href,
    ).href,
    live,
  }),
);

export function useRegistry<T>(selector: (store: RegistryStore) => T): T {
  return useStore(registryStore, selector);
}
