import type { Catalogue } from "./catalogue.ts";
import type { IncludeRules } from "./includes.ts";
import type { PaletteDefinition } from "./palette.ts";
import type { SourceParser } from "./source-file.ts";

/** A language pack (ADR 0006). M1 features grow this towards the architecture.md sketch. */
export interface LanguagePack {
  readonly version: string;
  /** The palette.yaml overlay (ADR 0025); small, loaded with the pack. */
  readonly palette: PaletteDefinition;
  /** Include resolution rules (AR-03, F-105): pure, loaded with the pack. */
  readonly includes: IncludeRules;
  /** The generated catalogue, loaded on first call (a dynamic import, so it stays out of the initial bundle; ADR 0028). */
  loadCatalogue(): Promise<Catalogue>;
  /** The parser with declaration-level fallback, loaded on first call (a dynamic import; ADR 0004, ADR 0027). */
  loadParser(): Promise<SourceParser>;
}

export * from "./ast/index.ts";
export type {
  Catalogue,
  CatalogueEntry,
  CatalogueSource,
  ConfigCatalogue,
  ConfigNode,
  FeatureFlagEntry,
  NamedGroup,
  OperatorEntry,
  Parameter,
  ScriptCatalogue,
  Signature,
} from "./catalogue.ts";
export type { Diagnostic, DiagnosticSeverity } from "./diagnostic.ts";
export type {
  Includable,
  IncludableDeclaration,
  IncludeRules,
  IncludeTarget,
  ProjectTree,
} from "./includes.ts";
export type {
  CatalogueItem,
  ConstructItem,
  OperatorGroupId,
  PaletteCategory,
  PaletteCategoryId,
  PaletteDefinition,
  PaletteGroup,
  PaletteIcon,
  PaletteItem,
  PaletteView,
  PaletteViewCategory,
  PaletteViewGroup,
  PaletteViewItem,
} from "./palette.ts";
export {
  PrintError,
  type PrintOptions,
  type PrintResult,
  type ScriptPrinter,
  type SourceLayout,
} from "./printer.ts";
export type {
  Callee,
  CallNode,
  ChainNode,
  ChainStep,
  CodeNode,
  Dataflow,
  EmitNode,
  FactoryNode,
  FlowType,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  NodeKey,
  NodeKeyLocal,
  OutputNode,
  ParamsNode,
  Port,
  PortRef,
  Projection,
  TakeNode,
  TypeExpr,
  WorkflowRef,
} from "./projection.ts";
export type {
  ConfigSourceFile,
  ConfigSourceParse,
  ParseStatus,
  PlainSourceFile,
  ScriptSourceFile,
  ScriptSourceParse,
  SourceFile,
  SourceLanguage,
  SourceParse,
  SourceParser,
} from "./source-file.ts";
