// The subset of the Nextflow registry API (OpenAPI 0.14.0, service 0.29.1) that the snapshot builder reads.

export interface ApiServiceInfo {
  readonly version: string;
  readonly commitId?: string;
}

export interface ApiModuleItem {
  readonly name?: string;
  readonly type?: string;
  readonly description?: string;
  readonly pattern?: string;
}

export interface ApiModuleChannel {
  readonly items?: readonly ApiModuleItem[];
  readonly tuple?: boolean;
}

export interface ApiModuleMetadata {
  readonly kind?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly componentName?: string;
  readonly requires?: { readonly modules?: readonly string[] };
  readonly input?: readonly ApiModuleChannel[];
  readonly output?: Readonly<Record<string, ApiModuleChannel>>;
}

export interface ApiModuleRelease {
  readonly version: string;
  /** "sha256:<hex>" of the tar.gz. */
  readonly checksum: string;
  readonly status?: string;
  readonly size?: number;
  readonly metadata?: ApiModuleMetadata;
}

export interface ApiModuleSummary {
  readonly name: string;
  readonly kind?: string;
  readonly revoked?: boolean;
}

export interface ApiModule extends ApiModuleSummary {
  readonly description?: string;
  readonly latest?: ApiModuleRelease;
}

export interface ApiPluginRelease {
  readonly version: string;
  readonly date?: string;
  readonly requires?: string;
  readonly status?: string;
  /** README markdown. */
  readonly description?: string;
  /** A JSON string (nextflow-io/schemas plugin/v1). */
  readonly spec?: string;
}

export interface ApiPlugin {
  readonly id: string;
  readonly provider?: string;
  readonly projectUrl?: string;
  /** In registry order: descending version, not date. */
  readonly releases: readonly ApiPluginRelease[];
}
