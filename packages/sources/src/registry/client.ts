import { toFailure } from "./errors.ts";
import { createLiveClient } from "./live.ts";
import {
  createSnapshotClient,
  fromSnapshot,
  type SnapshotClientOptions,
} from "./snapshot.ts";
import type { RegistryClient } from "./types.ts";

/** Off: registry.nextflow.io sends no CORS headers (spike S4; re-checked 2026-11-23; ADR 00NN). */
export const LIVE_REGISTRY = false;

export interface RegistryClientOptions extends SnapshotClientOptions {
  readonly live?: boolean; // LIVE_REGISTRY
  readonly registryUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/** The snapshot always; live on top of it when enabled, falling back to the snapshot (with liveFailure) if live fails. */
export function createRegistryClient(
  options: RegistryClientOptions,
): RegistryClient {
  const snapshot = createSnapshotClient(options);
  const live = options.live ?? LIVE_REGISTRY;
  const liveClient = live
    ? createLiveClient({
        snapshot,
        ...(options.registryUrl ? { registryUrl: options.registryUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.now ? { now: options.now } : {}),
      })
    : null;
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
