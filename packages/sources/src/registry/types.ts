import type {
  SnapshotModule,
  SnapshotModulePorts,
  SnapshotPlugin,
  SnapshotPluginFile,
} from "@nf-builder/lang-core";

export type RegistrySource = "live" | "snapshot";

/** `version` is null only for a module the live registry lists and the snapshot lacks: it has no bundle yet. */
export type RegistryModule = Omit<SnapshotModule, "version"> & {
  readonly version: string | null;
};

export type RegistryErrorCode =
  | "unavailable" // 404 or 410: the site serves no snapshot
  | "invalid" //     not a JSON content type, unparsable, or not format 1
  | "http" //        any other non-2xx
  | "network" //     fetch rejected: offline, DNS or CORS (browsers don't say which)
  | "timeout";

export interface RegistryFailure {
  readonly code: RegistryErrorCode;
  readonly message: string;
}

export interface RegistryIndex {
  readonly source: RegistrySource;
  /** ISO UTC: the snapshot's generatedAt, or when the live lists were read. UX-14's age. */
  readonly asOf: string;
  /** ISO UTC: the snapshot's generatedAt (live data overlays the snapshot). */
  readonly snapshotAt: string;
  /** From the snapshot: the pack that classified typed and legacy, and the Nextflow plugin releases were chosen for. */
  readonly language: string;
  readonly nextflow: string;
  /** Sorted by name. */
  readonly modules: readonly RegistryModule[];
  /** Sorted by id. Always snapshot entries: the live list can only remove plugins. */
  readonly plugins: readonly SnapshotPlugin[];
  /** Set when live was tried and failed, so this index is the snapshot. */
  readonly liveFailure: RegistryFailure | null;
}

export interface RegistryReadOptions {
  /** Skip the copy held in memory and revalidate with the server (fetch cache mode "no-cache"). */
  readonly refresh?: boolean;
}

export interface RegistryClient {
  /** The source this client prefers; RegistryIndex.source says which one answered. */
  readonly source: RegistrySource;
  index(options?: RegistryReadOptions): Promise<RegistryIndex>;
  /**
   * The module's meta.yml ports from the snapshot's ports.json (never live: ADR 0050), read on first use. null:
   * the name isn't in the file, such as a live-only module.
   */
  ports(
    name: string,
    options?: RegistryReadOptions,
  ): Promise<SnapshotModulePorts | null>;
  /**
   * A plugin's spec (plugins/<id>/<version>.json) from the snapshot, never live (ADR 0050), read once per id and
   * version. Rejects "unavailable" when the snapshot has no file for that release.
   */
  plugin(
    id: string,
    version: string,
    options?: RegistryReadOptions,
  ): Promise<SnapshotPluginFile>;
}
