// Registry snapshot format v1 (F-501, IO-31, ADR 0034). Types only: the tool writes it, packages/sources reads it.

export interface RegistrySnapshotIndex {
  readonly format: 1;
  /** ISO UTC, when the build started. */
  readonly generatedAt: string;
  /** "https://registry.nextflow.io" */
  readonly registry: string;
  /** The registry's service-info version, "0.29.1". */
  readonly apiVersion: string;
  /** The pack that classified typed and legacy, "26.10". */
  readonly language: string;
  /** The Nextflow version plugin releases were chosen for, "26.10.7". */
  readonly nextflow: string;
  /** Sorted by name. */
  readonly modules: readonly SnapshotModule[];
  /** Sorted by id. */
  readonly plugins: readonly SnapshotPlugin[];
}

export interface SnapshotModule {
  /** "nf-core/fastqc"; the namespace is the text before the first "/". */
  readonly name: string;
  /** The bundle is at modules/<name>/<version>.json. */
  readonly version: string;
  readonly kind: "process" | "workflow";
  /** "FASTQC" */
  readonly component: string | null;
  /** null: main.nf could not be modelled. */
  readonly typed: boolean | null;
  readonly description: string;
  readonly keywords: readonly string[];
}

export interface RegistrySnapshotPorts {
  readonly format: 1;
  /** Equals the index's. */
  readonly generatedAt: string;
  readonly modules: Readonly<Record<string, SnapshotModulePorts>>;
}

export interface SnapshotModulePorts {
  readonly inputs: readonly SnapshotPort[];
  readonly outputs: readonly SnapshotOutput[];
}

/** "<name>:<type>" (split at the last ":"; either side may be empty), or an array of them for a tuple. */
export type SnapshotPort = string | readonly string[];

export interface SnapshotOutput {
  readonly name: string | null;
  readonly port: SnapshotPort;
}

export interface SnapshotPlugin {
  readonly id: string;
  /** The highest published release that runs on the snapshot's `nextflow`. */
  readonly version: string;
  readonly requires: string | null;
  /** First non-heading paragraph of the description, at most 300 characters. */
  readonly summary: string;
  readonly provider: string | null;
  readonly projectUrl: string | null;
  /** 0: the release publishes no spec. */
  readonly definitions: number;
}

export interface SnapshotModuleBundle {
  readonly format: 1;
  readonly name: string;
  readonly version: string;
  /** "sha256:<hex>" of the registry tar.gz, verified. */
  readonly checksum: string;
  readonly component: string | null;
  readonly requires: readonly {
    readonly name: string;
    readonly version: string;
  }[];
  /** Every regular file, sorted by path. */
  readonly files: readonly SnapshotFile[];
}

export type SnapshotFile =
  | { readonly path: string; readonly text: string }
  | { readonly path: string; readonly base64: string };

export interface SnapshotPluginFile {
  readonly format: 1;
  readonly id: string;
  readonly version: string;
  readonly requires: string | null;
  readonly description: string;
  readonly definitions: readonly PluginDefinition[];
}

export interface PluginConfigOption {
  readonly name: string;
  readonly description?: string;
  readonly type: string;
  readonly additionalTypes?: readonly string[];
}

export interface PluginConfigScope {
  readonly name: string;
  readonly description?: string;
  readonly children?: readonly (PluginConfigScope | PluginConfigOption)[];
}

export interface PluginFunction {
  readonly name: string;
  readonly description?: string;
  readonly returnType?: string;
  readonly parameters?: readonly {
    readonly name: string;
    readonly type: string;
  }[];
}

export type PluginDefinition =
  | { readonly type: "ConfigScope"; readonly spec: PluginConfigScope }
  | {
      readonly type: "Function" | "Operator" | "Factory";
      readonly spec: PluginFunction;
    };
