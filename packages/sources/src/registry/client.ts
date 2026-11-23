import { toFailure } from "./errors.ts";
import { createLiveClient, type LiveClientOptions } from "./live.ts";
import {
  createSnapshotClient,
  fromSnapshot,
  type SnapshotClientOptions,
} from "./snapshot.ts";
import type { RegistryClient } from "./types.ts";

/** Off: registry.nextflow.io sends no CORS headers (spike S4; re-checked 2026-11-23; ADR 00NN). */
export const LIVE_REGISTRY = false;

export interface RegistryClientOptions
  extends SnapshotClientOptions,
    Omit<LiveClientOptions, "snapshot"> {
  readonly live?: boolean; // LIVE_REGISTRY
}

/** The snapshot always; live on top of it when enabled, falling back to the snapshot (with liveFailure) if live fails. */
export function createRegistryClient(
  options: RegistryClientOptions,
): RegistryClient {
  const snapshot = createSnapshotClient(options);
  const live = options.live ?? LIVE_REGISTRY;
  const liveClient = live ? createLiveClient({ ...options, snapshot }) : null;
  return {
    source: live ? "live" : "snapshot",
    async index(opts) {
      // Rejects with the snapshot's error when it fails: no live-only index.
      const base = await snapshot.snapshot(opts);
      if (!liveClient) return fromSnapshot(base);
      try {
        return await liveClient.index(opts);
      } catch (error) {
        return fromSnapshot(base, toFailure(error));
      }
    },
  };
}
