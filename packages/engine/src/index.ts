export type {
  AddCall,
  AddConfigBlock,
  AddConfigPlugin,
  AddEmit,
  AddInclude,
  AddTake,
  Callee,
  CallNode,
  ChainNode,
  ChainStep,
  CodeNode,
  CodeRow,
  CommandResult,
  ConfigContext,
  ConfigSelectorRef,
  ConfigSourceFile,
  ConfigValue,
  ConfigValueKind,
  Connect,
  CreateProcess,
  CreateWorkflow,
  Dataflow,
  DeclarationForm,
  DeleteNode,
  DeleteNodes,
  Diagnostic,
  DiagnosticCode,
  DirectiveChoice,
  DirectiveRow,
  Disconnect,
  EditCommand,
  EmitNode,
  FactoryNode,
  FieldProblem,
  FileText,
  FlowType,
  FormChoices,
  FormField,
  FormSection,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  IncludeTarget,
  InputRow,
  LintContext,
  LintRule,
  NodeKey,
  NodeKeyLocal,
  OutputNode,
  OutputRow,
  PackLints,
  PaletteCategoryId,
  PaletteIcon,
  PaletteView,
  PaletteViewCategory,
  PaletteViewItem,
  ParamsNode,
  ParseProblem,
  ParseStatus,
  PlainSourceFile,
  Port,
  PortRef,
  Projection,
  QuickFix,
  RefusalCode,
  RemoveConfigOption,
  RemoveConfigPlugin,
  RenameDeclaration,
  ReplaceFileText,
  ScriptSourceFile,
  SetConfigOption,
  SourceFile,
  SourceLanguage,
  SourceParser,
  StageChoice,
  StageRow,
  TakeNode,
  TextEdit,
  TextPatch,
  TopicRow,
  TypedProcessForm,
  TypeExpr,
  UpdateDeclaration,
  WorkflowRef,
  WorkflowTarget,
} from "@nf-builder/lang-core";
// paths that clash in an export (F-404): the page reads them through the engine package, which owns the lang-core dependency
export { exportClashes } from "@nf-builder/lang-core";
export type {
  CanvasAppearance,
  CanvasEdgeView,
  CanvasNodeView,
  CanvasPortView,
  CanvasView,
  CanvasViewOptions,
  EdgeDataflow,
} from "./canvas";
export { CANVAS_METRICS, canvasView, portY } from "./canvas";
export { edgeMismatches } from "./canvas/mismatch";
export * from "./config";
export { nodeView } from "./details/node-view";
export { workflowSuggestions } from "./details/suggestions";
export { workflowSummary } from "./details/summary";
export type {
  DeclarationDetails,
  DetailRow,
  NodeDetails,
  NodeView,
  OperatorDetail,
  OutlineItem,
  PortConnection,
  PortDetail,
  Preview,
  SummaryCall,
  SummaryCoverage,
  SummaryModule,
  SummaryPort,
  WorkflowSummary,
} from "./details/types";
export {
  compareDiagnostics,
  countDiagnostics,
  createDiagnoser,
  type Diagnoser,
  type DiagnoserOptions,
  type DiagnosticCounts,
} from "./diagnostics/diagnose";
export { loadLints } from "./diagnostics/lints";
export { applyTextEdits } from "./diagnostics/text-edits";
export {
  applyCommand,
  commit,
  createEditState,
  type EditState,
} from "./edit/apply";
export {
  type ConnectionStatus,
  type ConnectionTarget,
  connectionTargets,
} from "./edit/connection-targets";
export { isIdentifier } from "./edit/names";
export { applyPatches, PatchError } from "./edit/patches";
export { planAdd } from "./files/add";
export {
  ancestorsOf,
  folderOf,
  isManagedPath,
  joinFolder,
  newFolderProblem,
  newPathProblem,
  projectTreeOf,
  readOnlyReason,
} from "./files/paths";
export {
  fileTreeRows,
  folderSet,
} from "./files/tree";
export type {
  AddConflict,
  FileTreeRow,
  ReadOnlyReason,
} from "./files/types";
export { formChanged } from "./form/form-diff";
export { type PopupTarget, popupTarget } from "./form/popup-target";
export {
  EMPTY_HISTORY,
  type HistoryLimits,
  type HistoryStatus,
} from "./history/history";
export { commandLabel } from "./history/labels";
export * from "./layout";
export type {
  Binding,
  ConfigIncludeModel,
  FileModel,
  ResolvedEntry,
  ResolvedInclude,
  ScriptIncludeModel,
} from "./model/file-model";
export {
  type ModelChange,
  type ModelEvent,
  openProject,
  type ProjectFile,
  ProjectModel,
  type ProjectModelOptions,
} from "./model/project";
export { defaultWorkflowRef } from "./navigation";
export { installedPackVersions } from "./packs";
export { loadPalette } from "./palette";
export { type PaletteAction, paletteAction } from "./palette-actions";
export { paletteItemCount, queryTerms, searchPalette } from "./palette-search";
export {
  type PluginScopes,
  pluginConfigNodes,
  pluginsKey,
} from "./plugins/config-scopes";
export type { DeclaredPlugin } from "./plugins/declared";
export {
  type PluginPaletteGroup,
  type PluginPaletteItem,
  pluginPaletteGroup,
  searchPluginGroups,
} from "./plugins/palette";
export {
  nodeAtRange,
  type ProblemCounts,
  type ProblemGroup,
  type ProblemSections,
  type ProblemsView,
  type ProblemTarget,
  problemKey,
  problemSections,
  problemsView,
  problemTarget,
} from "./problems";
export { projectionCoverage } from "./projection/coverage";
export type {
  FreeRead,
  StatementVariables,
  Write,
} from "./projection/free-variables";
export { statementVariables } from "./projection/free-variables";
export { formatNodeKey, parseNodeKey } from "./projection/keys";
export {
  createProjector,
  type Projector,
  type ProjectorOptions,
} from "./projection/project";
export { formatFlowType, formatType } from "./projection/types";
export {
  legacyShare,
  type ParseFailure,
  type ProjectReport,
  projectReport,
  type StyleCounts,
} from "./report/report";
export {
  createEngineService,
  type EngineServiceOptions,
} from "./service/service";
export type {
  Applied,
  ApplyOptions,
  ApplyOutcome,
  CalleeRequest,
  CallPathResult,
  ClipboardSummary,
  ConfigViewResult,
  ConnectionTargetsRequest,
  ConnectionTargetsResult,
  Copied,
  CopyRequest,
  DeclarationFormResult,
  DiagnosticsResult,
  EngineApi,
  EngineRefusal,
  EngineRefusalCode,
  FileSummary,
  FreshName,
  HistoryOutcome,
  LoadPhase,
  LoadProgress,
  NodeDetailsResult,
  OpenRequest,
  OutlineResult,
  PasteAlias,
  Pasted,
  PasteRequest,
  PluginsResult,
  ProjectChange,
  ProjectFiles,
  ProjectionResult,
  ProjectSummary,
  RegistryFolder,
  Undone,
} from "./service/types";
export {
  type Equivalence,
  equivalent,
  normaliseText,
} from "./source/equivalent";
export { type TopLevelItem, topLevelItems } from "./source/items";
export { languageOf } from "./source/language";
export { loadParser } from "./source/parser";
export { printSourceFile } from "./source/print";
export { createSourceFile } from "./source/source-file";
export { verifyModel } from "./source/verify";
export {
  BLANK_TEMPLATE,
  type TemplateList,
  templateFiles,
  templateList,
} from "./templates";
