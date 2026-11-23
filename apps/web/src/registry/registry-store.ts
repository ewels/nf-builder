import {
  LIVE_REGISTRY,
  type RegistryClient,
  type RegistryFailure,
  type RegistryIndex,
  toFailure,
} from "@nf-builder/sources";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { appRegistryClient } from "./registry-client";

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
  const getClient = () => {
    client ??= makeClient(LIVE_REGISTRY);
    return client;
  };

  return createStore<RegistryStore>()((set, get) => {
    const setState = (state: RegistryState) => set({ state });

    async function first(): Promise<void> {
      const mine = generation;
      try {
        const index = await getClient().index();
        if (mine !== generation) return;
        setState({
          status: "ready",
          index,
          refreshing: false,
          refreshFailure: null,
        });
      } catch (error) {
        if (mine !== generation) return;
        setState({
          status: "failed",
          failure: toFailure(error),
          refreshing: false,
        });
      }
    }

    return {
      state: { status: "idle" },
      load() {
        if (get().state.status !== "idle") return;
        setState({ status: "loading" });
        void first();
      },
      refresh() {
        const state = get().state;
        if (state.status !== "ready" && state.status !== "failed") return;
        if (state.refreshing) return;
        const mine = generation;
        setState({ ...state, refreshing: true });
        getClient()
          .index({ refresh: true })
          .then(
            (index) => {
              if (mine !== generation) return;
              setState({
                status: "ready",
                index,
                refreshing: false,
                refreshFailure: null,
              });
            },
            (error: unknown) => {
              if (mine !== generation) return;
              const failure = toFailure(error);
              setState(
                state.status === "ready"
                  ? { ...state, refreshing: false, refreshFailure: failure }
                  : { status: "failed", failure, refreshing: false },
              );
            },
          );
      },
      async reload({ live }) {
        generation++;
        client = makeClient(live);
        setState({ status: "loading" });
        await first();
      },
    };
  });
}

export const registryStore = createRegistryStore(appRegistryClient);

export function useRegistry<T>(selector: (store: RegistryStore) => T): T {
  return useStore(registryStore, selector);
}
