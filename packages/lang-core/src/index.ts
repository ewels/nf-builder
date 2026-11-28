import type { Catalogue, ConfigCatalogue } from "./catalogue.ts";
import type { ConfigRules } from "./config.ts";
import type { Scaffold } from "./edit.ts";
import type { IncludeRules } from "./includes.ts";
import type { PackLints } from "./lint.ts";
import type { PaletteDefinition } from "./palette.ts";
import type { SourceParser } from "./source-file.ts";
import type { TemplateSet } from "./templates.ts";

/** An operator that legacy workflows call but the catalogue lacks (AR-14, F-107): its result kind from the docs. */
export interface LegacyOperator {
  readonly name: string;
  /** `assign` marks `set` and `tap`, which bind a variable rather than give a result. */
  readonly result: "channel" | "value" | "assign";
}

/** A language pack (ADR 0006). M1 features grow this towards the architecture.md sketch. */
export interface LanguagePack {
  readonly version: string;
  /** The palette.yaml overlay (ADR 0025); small, loaded with the pack. */
  readonly palette: PaletteDefinition;
  /** Include resolution rules (AR-03, F-105): pure, loaded with the pack. */
  readonly includes: IncludeRules;
  /** New-file templates (LA-02, LA-12): pure, loaded with the pack. */
  readonly scaffold: Scaffold;
  /** Legacy-only operators, with their result kinds (F-107): pure, loaded with the pack. */
  readonly legacyOperators: readonly LegacyOperator[];
  /** Documented standard type names the generated catalogue lacks (F-303): pure, loaded with the pack. */
  readonly standardTypes?: readonly string[];
  /** The generated catalogue, loaded on first call (a dynamic import, so it stays out of the initial bundle; ADR 0028). */
  loadCatalogue(): Promise<Catalogue>;
  /** The parser with declaration-level fallback, loaded on first call (a dynamic import; ADR 0004, ADR 0027). */
  loadParser(): Promise<SourceParser>;
  /** The diagnostic codes, advice and rules, loaded on first call (a dynamic import, so it stays out of the initial bundle; QA-01, F-112). */
  loadLints(): Promise<PackLints>;
  /** The project templates (LA-02, F-203), loaded on first call (a dynamic import of a generated JSON chunk, so it stays out of the initial bundle). */
  loadTemplates(): Promise<TemplateSet>;
  /**
   * The config editor's rules over the config catalogue (F-601), loaded on first call and kept. With a `catalogue` (the
   * pack's with plugin scopes merged in, F-505), fresh rules over that one, not kept.
   */
  loadConfigRules(catalogue?: ConfigCatalogue): Promise<ConfigRules>;
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
export type {
  ConfigFormLayout,
  ConfigPathClass,
  ConfigRules,
  ConfigScopeForm,
  ConfigValueKind,
} from "./config.ts";
export type {
  CodeRow,
  DeclarationForm,
  DirectiveChoice,
  DirectiveRow,
  FieldProblem,
  FormChoices,
  FormField,
  FormSection,
  InputRow,
  OutputRow,
  StageChoice,
  StageRow,
  TopicRow,
  TypedProcessForm,
} from "./declaration-form.ts";
export type { Diagnostic, DiagnosticSeverity, QuickFix } from "./diagnostic.ts";
export {
  type AddCall,
  type AddConfigBlock,
  type AddConfigPlugin,
  type AddInclude,
  type CommandResult,
  type ConfigContext,
  type ConfigSelectorRef,
  type ConfigValue,
  type Connect,
  type CreateFile,
  type CreateProcess,
  type CreateWorkflow,
  type DeleteNode,
  type DeleteNodes,
  type Disconnect,
  type DurationUnitName,
  EDIT_COMMAND_KINDS,
  type EditCommand,
  type FileText,
  type MemoryUnitName,
  type MoveFile,
  type RefusalCode,
  type RemoveConfigOption,
  type RemoveConfigPlugin,
  type RenameDeclaration,
  type ReplaceDeclaration,
  type ReplaceFileText,
  type Scaffold,
  type SetConfigOption,
  type TextEdit,
  type TextPatch,
  type UpdateDeclaration,
  type WorkflowTarget,
} from "./edit.ts";
export type {
  Includable,
  IncludableDeclaration,
  IncludeRules,
  IncludeTarget,
  ProjectTree,
} from "./includes.ts";
export type {
  Compatibility,
  DiagnosticCode,
  DiagnosticOrigin,
  LintBinding,
  LintContext,
  LintFinding,
  LintFix,
  LintInclude,
  LintRule,
  PackLints,
} from "./lint.ts";
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
export { exportClashes, projectPathProblem } from "./paths.ts";
export {
  type ConfigPrinter,
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
  Guard,
  NodeKey,
  NodeKeyLocal,
  OutputNode,
  ParamsNode,
  Port,
  PortRef,
  ProjectedStatement,
  Projection,
  TakeNode,
  TypeExpr,
  WorkflowRef,
} from "./projection.ts";
export type {
  PluginConfigChild,
  PluginConfigOption,
  PluginConfigScope,
  PluginDefinition,
  PluginFunction,
  PluginTypeRef,
  RegistrySnapshotIndex,
  RegistrySnapshotPorts,
  SnapshotFile,
  SnapshotModule,
  SnapshotModuleBundle,
  SnapshotModulePorts,
  SnapshotOutput,
  SnapshotPlugin,
  SnapshotPluginFile,
  SnapshotPort,
} from "./registry-snapshot.ts";
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
export type {
  ProjectTemplate,
  TemplateFile,
  TemplateInfo,
  TemplateSet,
} from "./templates.ts";
