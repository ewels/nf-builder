import { toFailure } from "./errors.ts";
import { type LiveReadOptions, overlayLive, readLiveLists } from "./live.ts";
import {
  createSnapshotClient,
  fromSnapshot,
  type SnapshotClientOptions,
} from "./snapshot.ts";
import type { RegistryClient } from "./types.ts";

/** Off: registry.nextflow.io sends no CORS headers (spike S4; re-checked 2026-11-23; ADR 0050). */
export const LIVE_REGISTRY = false;

export interface RegistryClientOptions
  extends SnapshotClientOptions,
    LiveReadOptions {
  readonly live?: boolean; // LIVE_REGISTRY
  readonly now?: () => Date;
}

/** The snapshot always; live on top of it when enabled, falling back to the snapshot (with liveFailure) if live fails. */
export function createRegistryClient(
  options: RegistryClientOptions,
): RegistryClient {
  const snapshot = createSnapshotClient(options);
  const live = options.live ?? LIVE_REGISTRY;
  const now = options.now ?? (() => new Date());
  return {
    source: live ? "live" : "snapshot",
    async index(opts) {
      // Rejects with the snapshot's error when it fails: no live-only index.
      const base = await snapshot.snapshot(opts);
      if (!live) return fromSnapshot(base);
      try {
        return overlayLive(
          base,
          await readLiveLists(options),
          now().toISOString(),
        );
      } catch (error) {
        return fromSnapshot(base, toFailure(error));
      }
    },
  };
}
