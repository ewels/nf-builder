// The catalogue contract (ADR 0005, ADR 0020): what a language pack's generated catalogue/*.json files contain.
// Types only, so the palette, the inspector and the printer share one shape.

export type CatalogueSource = {
  generator: "tools/spec-extract";
  /** The language server release the catalogue was extracted from. */
  languageServer: string;
  nfLang: string;
  jarSha256: string;
};

export type Parameter = { name: string; type: string };

export type Signature = {
  parameters: Parameter[];
  returns: string;
  varargs: boolean;
  deprecated: boolean;
};

export type CatalogueEntry = {
  name: string;
  description: string;
  /** True when every signature is deprecated. */
  deprecated: boolean;
  signatures: Signature[];
};

/** For operators, `deprecated` means discouraged with static typing: the operator is legacy-only. */
export type OperatorEntry = CatalogueEntry & { receiver: "Channel" | "Value" };

export type NamedGroup = {
  name: string;
  description: string;
  members: CatalogueEntry[];
};

export type FeatureFlagEntry = {
  name: string;
  description: string;
  type: string;
  preview: boolean;
};

export type ScriptCatalogue = {
  source: CatalogueSource;
  directives: CatalogueEntry[];
  processSections: {
    inputs: CatalogueEntry[];
    outputs: CatalogueEntry[];
    typedOutputs: CatalogueEntry[];
    stage: CatalogueEntry[];
  };
  agentDirectives: CatalogueEntry[];
  operators: OperatorEntry[];
  factories: CatalogueEntry[];
  constants: CatalogueEntry[];
  functions: CatalogueEntry[];
  namespaces: NamedGroup[];
  types: NamedGroup[];
  featureFlags: FeatureFlagEntry[];
};

export type ConfigNode =
  | { kind: "scope"; name: string; description: string; children: ConfigNode[] }
  | { kind: "option"; name: string; description: string; types: string[] }
  | {
      kind: "placeholder";
      name: string;
      description: string;
      placeholderName: string;
      children: ConfigNode[];
    }
  | { kind: "dsl"; name: string; description: string; dsl: string };

export type ConfigCatalogue = { source: CatalogueSource; scopes: ConfigNode[] };

/** A pack's generated catalogue (ADR 0005, ADR 0020). */
export type Catalogue = {
  readonly script: ScriptCatalogue;
  readonly config: ConfigCatalogue;
};
