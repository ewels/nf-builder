// The config AST (AR-02, F-103). Values and closure bodies are the script AST's expressions and statements, so config
// and script code share one expression layer (ADR 0027). The tree stays syntactic: profiles, `params` and `env` are
// ordinary blocks, and F-601 maps names to the catalogue. Field order is source order (`childNodes` relies on it).
import type { Comment, NodeBase } from "./range.ts";
import type {
  Argument,
  Expression,
  Identifier,
  IfStatement,
  TryCatch,
  VariableDeclaration,
} from "./script.ts";

/** A name in a config path, block header or selector: `docker`, `'foo-bar'` (`name` is the decoded value), `int`. */
export interface ConfigName extends NodeBase<"ConfigName"> {
  readonly name: string;
  readonly form: "identifier" | "string" | "builtInType";
}
/** `docker.enabled = true` (nf-lang `ConfigAssignNode`). */
export interface ConfigAssign extends NodeBase<"ConfigAssign"> {
  readonly path: readonly ConfigName[];
  readonly value: Expression;
}
/** `name { ... }`: a scope, `profiles`, a profile, `params`, `env`. */
export interface ConfigBlock extends NodeBase<"ConfigBlock"> {
  readonly name: ConfigName;
  readonly statements: readonly ConfigStatement[];
}
/** `withName: 'FOO' { ... }` (nf-lang `ConfigBlockNode` with a kind); `selector` is the identifier as written. */
export interface ConfigSelector extends NodeBase<"ConfigSelector"> {
  readonly selector: ConfigName;
  readonly target: ConfigName;
  readonly statements: readonly ConfigStatement[];
}
/** `plugins { id 'nf-schema@2.1.0' }`. Any other name is an error (nf-lang `ConfigApplyBlockNode`). */
export interface ConfigApplyBlock extends NodeBase<"ConfigApplyBlock"> {
  readonly name: ConfigName;
  readonly statements: readonly ConfigApply[];
}
export interface ConfigApply extends NodeBase<"ConfigApply"> {
  readonly name: Identifier;
  readonly args: readonly Argument[];
}
/** `includeConfig <expression>` (FI-05). */
export interface ConfigInclude extends NodeBase<"ConfigInclude"> {
  readonly source: Expression;
}
/** `process.cpus` or `process.`, with no value: an error. */
export interface ConfigIncomplete extends NodeBase<"ConfigIncomplete"> {
  readonly path: readonly ConfigName[];
  readonly trailingDot: boolean;
}
/** An if, try or `def` among config statements. nf-lang reports and drops it; we keep it (ADR 0004). */
export interface ConfigInvalid extends NodeBase<"ConfigInvalid"> {
  readonly statement: IfStatement | TryCatch | VariableDeclaration;
}
export type ConfigStatement =
  | ConfigAssign
  | ConfigBlock
  | ConfigSelector
  | ConfigApplyBlock
  | ConfigInclude
  | ConfigIncomplete
  | ConfigInvalid;

/** The config root: the whole text. */
export interface ConfigAst extends NodeBase<"ConfigFile"> {
  readonly statements: readonly ConfigStatement[];
  /** The comment map (AR-01): every comment, in source order. */
  readonly comments: readonly Comment[];
}
