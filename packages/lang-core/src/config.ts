// What the config editor and the `config-unknown-option` warning know about a config path (F-601, FI-02 to FI-04): the
// pack's rules over its config catalogue. Types and pure data only, so the engine and the page share one shape.

/** How the form edits an option (2.4 of the F-601 plan). `code` is read-only. */
export type ConfigValueKind =
  | "string"
  | "boolean"
  | "integer"
  | "decimal"
  | "memory"
  | "duration"
  | "stringList"
  | "map"
  | "code";

/**
 * What a full option path (selectors dropped, profile contents as top level) is, as Nextflow's run-time `ConfigValidator`
 * sees it: a catalogue option, a scope, the `plugins` DSL, a name nobody validates (`params`, `env`, keys under a Map
 * option), a hidden option, an option of a core plugin scope the catalogue doesn't describe, or an unknown name.
 */
export type ConfigPathClass =
  | {
      readonly kind: "option";
      readonly types: readonly string[];
      readonly description: string;
    }
  | { readonly kind: "scope"; readonly description: string }
  | { readonly kind: "dsl" }
  | { readonly kind: "free"; readonly owner: "params" | "env" | "map" }
  | { readonly kind: "hidden" }
  | { readonly kind: "unchecked" }
  | { readonly kind: "unknown" };

/** A first-class form (FI-02): `pinned` options are always shown, in this order. */
export interface ConfigScopeForm {
  readonly scope: string;
  readonly form: "options" | "params" | "process" | "profiles" | "plugins";
  readonly pinned: readonly string[];
}

export interface ConfigFormLayout {
  readonly scopes: readonly ConfigScopeForm[];
  /** Fixed-key map options, by dotted path: the key and the kind of its value. */
  readonly maps: Readonly<
    Record<string, Readonly<Record<string, ConfigValueKind>>>
  >;
}

export interface ConfigRules {
  readonly forms: ConfigFormLayout;
  /** `names` are a full option path as `ConfigValidator` names it. */
  classify(names: readonly string[]): ConfigPathClass;
  valueKind(
    names: readonly string[],
    types: readonly string[],
  ): ConfigValueKind;
  /** A verified page of the Nextflow docs for the path, or null for a path the catalogue doesn't know. */
  docsUrl(names: readonly string[]): string | null;
}
