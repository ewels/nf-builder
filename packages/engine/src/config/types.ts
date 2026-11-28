// The config editor's view of one config file, as plain data (F-601, AR-30). Nothing here holds a file's text beyond
// excerpts of at most `EXCERPT_LIMIT` characters on one line, so a view stays small whatever the file.
import type {
  ConfigContext,
  ConfigFormLayout,
  ConfigPathClass,
  ConfigScopeForm,
  ConfigSelectorRef,
  ConfigValue,
  ConfigValueKind,
  Diagnostic,
  ParseStatus,
  Range,
} from "@nf-builder/lang-core";

/** The longest code excerpt a view carries. */
export const EXCERPT_LIMIT = 160;

/** A process the entry workflow reaches, with every name a `withName` selector can match (FI-06). */
export interface ProcessUse {
  /** The fully qualified name: enclosing workflows' invoked names, then the process's, joined by `:`. */
  readonly fq: string;
  /** The name it is invoked by (an include alias, if any). */
  readonly simple: string;
  /** The name it is declared by. */
  readonly base: string;
  readonly labels: readonly string[];
  /** The file that declares the process. */
  readonly path: string;
}

export interface ProcessUses {
  /** The path of the entry workflow's file; null when there is none and every declaration counts. */
  readonly entry: string | null;
  readonly uses: readonly ProcessUse[];
}

export interface SelectorMatch {
  /** Distinct fully qualified names matched; null for a pattern that can't be evaluated. */
  readonly count: number | null;
  /** Up to 50 of them. */
  readonly processes: readonly string[];
  readonly note: string | null;
}

export interface OptionRow {
  readonly kind: "option";
  readonly key: string;
  /** The full option path as `ConfigValidator` names it (selectors dropped). */
  readonly option: readonly string[];
  /** The path under its scope, joined by dots. */
  readonly label: string;
  readonly class: ConfigPathClass["kind"];
  readonly types: readonly string[];
  readonly valueKind: ConfigValueKind;
  /** The decoded value, or null when the form can't model it (then `code` holds an excerpt). */
  readonly value: ConfigValue | null;
  readonly code: string | null;
  /** How many statements set it in this context; the last wins. */
  readonly occurrences: number;
  readonly range: Range;
  readonly nameRange: Range;
  readonly diagnostics: readonly Diagnostic[];
}

export interface IncludeRow {
  readonly kind: "include";
  readonly key: string;
  readonly range: Range;
  /** An excerpt of the source expression. */
  readonly source: string;
  readonly target:
    | { readonly kind: "file"; readonly path: string }
    | { readonly kind: "missing"; readonly message: string }
    | { readonly kind: "external" };
}

export interface CodeRow {
  readonly kind: "code";
  readonly key: string;
  readonly range: Range;
  readonly text: string;
  readonly reason: "value" | "invalid" | "incomplete" | "unparsed";
  readonly problems: readonly string[];
}

export interface PluginRow {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
  readonly range: Range;
}

export type ConfigRow = OptionRow | IncludeRow | CodeRow;

export interface SelectorCard {
  readonly key: string;
  /** Null for a selector the form can't edit: an unknown kind, or one outside `process`. */
  readonly selector: ConfigSelectorRef | null;
  /** The selector as written: `withLabel: big_mem`. */
  readonly written: string;
  readonly range: Range;
  readonly rows: readonly ConfigRow[];
  readonly match: SelectorMatch | null;
}

export interface ProfileCard {
  readonly key: string;
  readonly name: string;
  readonly range: Range;
  readonly items: readonly ConfigViewItem[];
}

export interface ScopeCard {
  readonly key: string;
  /** The scope's name; empty for the card of unscoped options. */
  readonly scope: string;
  readonly known: boolean;
  readonly form: ConfigScopeForm["form"] | "generic" | "unscoped";
  readonly pinned: readonly string[];
  readonly rows: readonly ConfigRow[];
  readonly selectors: readonly SelectorCard[];
  readonly profiles: readonly ProfileCard[];
  readonly plugins: readonly PluginRow[];
  readonly range: Range;
}

export type ConfigViewItem =
  | { readonly kind: "scope"; readonly card: ScopeCard }
  | IncludeRow
  | CodeRow;

export interface ConfigView {
  readonly path: string;
  readonly status: ParseStatus;
  /** False while the file has any parse problem: the form is then read-only. */
  readonly editable: boolean;
  readonly context: ConfigContext;
  readonly items: readonly ConfigViewItem[];
}

export interface ConfigSchemaNode {
  readonly kind: "scope" | "option" | "placeholder" | "dsl";
  readonly name: string;
  readonly path: readonly string[];
  readonly description: string;
  readonly docsUrl: string | null;
  readonly types: readonly string[];
  readonly valueKind: ConfigValueKind | null;
  readonly children: readonly ConfigSchemaNode[];
}

export interface ConfigSchema {
  readonly version: string;
  readonly scopes: readonly ConfigSchemaNode[];
  readonly forms: ConfigFormLayout;
}
