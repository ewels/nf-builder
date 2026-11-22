// The script AST (AR-02), one node kind per construct in the Nextflow 26.10 syntax reference, typed and legacy
// (LA-10). Kind strings are PascalCase; field order is source order wherever the grammar fixes it (`childNodes`
// relies on it). Conventions: ADR 0027.
import type { Comment, NodeBase, Range } from "./range.ts";

export interface Identifier extends NodeBase<"Identifier"> {
  readonly name: string;
}

export interface ScriptAst extends NodeBase<"Script"> {
  /** The whole text: `[0, text.length)`. */
  readonly shebang: Comment | null;
  /** Declarations and top-level statements, in source order. */
  readonly body: readonly ScriptItem[];
  /** The comment map (AR-01): every comment but the shebang, in source order. */
  readonly comments: readonly Comment[];
  /** `nextflow.enable.types = true` appears. */
  readonly typesEnabled: boolean;
}

export type ScriptItem = Declaration | Statement | InvalidDeclaration;
export type Declaration =
  | FeatureFlag
  | Include
  | ImportDeclaration
  | ParamsBlock
  | LegacyParam
  | RecordDef
  | EnumDef
  | ProcessDef
  | AgentDef
  | WorkflowDef
  | OutputBlock
  | FunctionDef
  | IncompleteDeclaration;

/** `name` is the dotted name, e.g. `nextflow.enable.types`. */
export interface FeatureFlag extends NodeBase<"FeatureFlag"> {
  readonly name: Identifier;
  readonly value: Expression;
}
export interface Include extends NodeBase<"Include"> {
  readonly entries: readonly IncludeEntry[];
  readonly source: StringLiteral;
}
export interface IncludeEntry extends NodeBase<"IncludeEntry"> {
  readonly name: Identifier;
  readonly alias: Identifier | null;
}
/** Always an error (nf-lang `ScriptAstBuilder.java#L339`). */
export interface ImportDeclaration extends NodeBase<"Import"> {
  readonly name: string;
}
export interface ParamsBlock extends NodeBase<"ParamsBlock"> {
  readonly params: readonly Param[];
}
export interface Param extends NodeBase<"Param"> {
  readonly name: Identifier;
  readonly type: TypeRef | null;
  readonly defaultValue: Expression | null;
}
/** `params.a.b = value` */
export interface LegacyParam extends NodeBase<"LegacyParam"> {
  readonly target: PropertyExpr;
  readonly value: Expression;
}
export interface RecordDef extends NodeBase<"Record"> {
  readonly name: Identifier;
  readonly fields: readonly TypedName[];
}
export interface EnumDef extends NodeBase<"Enum"> {
  readonly name: Identifier;
  readonly constants: readonly Identifier[];
  readonly trailingComma: boolean;
}

export type SectionLabel =
  | "input"
  | "stage"
  | "output"
  | "topic"
  | "when"
  | "script"
  | "shell"
  | "exec"
  | "stub"
  | "prompt"
  | "take"
  | "main"
  | "emit"
  | "publish"
  | "onComplete"
  | "onError";
export interface Section<T> extends NodeBase<"Section"> {
  /** `null`: directives, an implicit workflow main, an implicit process script body. */
  readonly label: SectionLabel | null;
  /** `input:`, from the label to the colon. */
  readonly labelRange: Range | null;
  readonly items: readonly T[];
}
interface ProcessCommon {
  readonly name: Identifier;
  readonly directives: Section<ExpressionStatement> | null;
  readonly when: Section<Expression> | null;
  /** `null` only for an empty body (`ScriptAstBuilder.java#L518`). */
  readonly exec: Section<Statement> | null;
  readonly stub: Section<Statement> | null;
}
export interface LegacyProcess extends NodeBase<"Process">, ProcessCommon {
  readonly typed: false;
  /** Calls such as `val(x)`, `tuple(val(a), path(b))`, `path x, stageAs: 'y'`. */
  readonly inputs: Section<ExpressionStatement> | null;
  readonly outputs: Section<ExpressionStatement> | null;
}
export interface TypedProcess extends NodeBase<"Process">, ProcessCommon {
  readonly typed: true;
  readonly inputs: Section<ProcessInput> | null;
  readonly stage: Section<ExpressionStatement> | null;
  readonly outputs: Section<NamedOutput | ExpressionStatement> | null;
  /** Each a `>>` binary expression. */
  readonly topics: Section<ExpressionStatement> | null;
}
export type ProcessDef = LegacyProcess | TypedProcess;
export type ProcessInput = TypedName | RecordInput | TupleInput;
export interface RecordInput extends NodeBase<"RecordInput"> {
  readonly fields: readonly TypedName[];
  readonly trailingComma: boolean;
}
export interface TupleInput extends NodeBase<"TupleInput"> {
  readonly components: readonly TypedName[];
  readonly trailingComma: boolean;
}
export interface NamedOutput extends NodeBase<"NamedOutput"> {
  readonly name: Identifier;
  readonly type: TypeRef | null;
  readonly value: Expression | null;
}
export interface AgentDef extends NodeBase<"Agent"> {
  readonly name: Identifier;
  readonly directives: Section<ExpressionStatement> | null;
  readonly inputs: Section<ProcessInput> | null;
  readonly outputs: Section<NamedOutput | ExpressionStatement> | null;
  /** `null` only for an empty body (`ScriptAstBuilder.java#L851`). */
  readonly prompt: Section<Statement> | null;
}
export interface WorkflowDef extends NodeBase<"Workflow"> {
  /** `null`: the entry workflow. */
  readonly name: Identifier | null;
  /** Types were enabled when it was built. */
  readonly typed: boolean;
  readonly takes: Section<TypedName> | null;
  readonly main: Section<Statement> | null;
  readonly emits: Section<NamedOutput | ExpressionStatement> | null;
  readonly publishers: Section<NamedOutput> | null;
  readonly onComplete: Section<Statement> | null;
  readonly onError: Section<Statement> | null;
}
export interface OutputBlock extends NodeBase<"OutputBlock"> {
  readonly outputs: readonly OutputDecl[];
}
export interface OutputDecl extends NodeBase<"Output"> {
  readonly name: Identifier;
  readonly type: TypeRef | null;
  readonly body: Block;
}
export interface FunctionDef extends NodeBase<"Function"> {
  readonly name: Identifier;
  readonly def: boolean;
  readonly params: readonly FormalParameter[];
  /** `-> T` */
  readonly returnType: TypeRef | null;
  /** `String f()`, `def String f()` */
  readonly legacyReturnType: LegacyType | null;
  readonly body: Block;
}
/** `foo.bar.` (an error). */
export interface IncompleteDeclaration
  extends NodeBase<"IncompleteDeclaration"> {
  readonly text: string;
}
/** A top-level call named agent, process, workflow or output that failed to parse as a declaration (`#L251-L260`). */
export interface InvalidDeclaration extends NodeBase<"InvalidDeclaration"> {
  readonly keyword: "agent" | "process" | "workflow" | "output";
  readonly statement: Statement;
}

// Statements. `labels` holds the `name:` labels of a statement inside a closure with labels; its range starts at the
// first label.
interface StatementBase<K extends string> extends NodeBase<K> {
  readonly labels?: readonly Identifier[];
}
export type Statement =
  | Block
  | ExpressionStatement
  | VariableDeclaration
  | Assignment
  | IfStatement
  | TryCatch
  | ReturnStatement
  | ThrowStatement
  | AssertStatement
  | EmptyStatement;
/** The range includes the braces. */
export interface Block extends StatementBase<"Block"> {
  readonly statements: readonly Statement[];
}
export interface ExpressionStatement
  extends StatementBase<"ExpressionStatement"> {
  readonly expression: Expression;
}
export interface VariableDeclaration
  extends StatementBase<"VariableDeclaration"> {
  readonly def: boolean;
  readonly legacyType: LegacyType | null;
  readonly targets: readonly TypedName[];
  /** `def (a, b) = ...` */
  readonly multiple: boolean;
  readonly initializer: Expression | null;
}
export type AssignmentOperator = (typeof ASSIGNMENT_OPERATORS)[number];
export interface Assignment extends StatementBase<"Assignment"> {
  readonly target: Expression | TupleTarget;
  readonly operator: AssignmentOperator;
  readonly value: Expression;
}
/** `(a, b) = ...`, `(a) = ...` */
export interface TupleTarget extends NodeBase<"TupleTarget"> {
  readonly names: readonly Variable[];
}
export interface IfStatement extends StatementBase<"If"> {
  readonly condition: Expression;
  readonly consequent: Statement;
  readonly alternate: Statement | null;
  /** The `else` keyword: it tells which branch a comment between the two belongs to. */
  readonly elseRange: Range | null;
}
export interface TryCatch extends StatementBase<"TryCatch"> {
  readonly body: Statement;
  readonly catches: readonly CatchClause[];
}
export interface CatchClause extends NodeBase<"Catch"> {
  readonly variable: Identifier;
  readonly types: readonly TypeRef[];
  /** `catch (T e)` */
  readonly legacy: boolean;
  readonly body: Statement;
}
export interface ReturnStatement extends StatementBase<"Return"> {
  readonly value: Expression | null;
}
export interface ThrowStatement extends StatementBase<"Throw"> {
  readonly value: Expression;
}
export interface AssertStatement extends StatementBase<"Assert"> {
  readonly condition: Expression;
  readonly message: Expression | null;
}
export interface EmptyStatement extends StatementBase<"EmptyStatement"> {}

// Expressions
export type Expression =
  | Variable
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | GString
  | ListExpr
  | MapExpr
  | Closure
  | PropertyExpr
  | IndexExpr
  | MethodCall
  | CallExpr
  | NewExpr
  | UnaryExpr
  | BinaryExpr
  | CastExpr
  | TypeTestExpr
  | TernaryExpr
  | ElvisExpr
  | Parenthesized
  | IncompleteExpression;
export type Navigation = "." | "*." | "?.";
/** Also a built-in type used as a value. */
export interface Variable extends NodeBase<"Variable"> {
  readonly name: string;
}
/** `text` is verbatim, suffix kept. */
export interface NumberLiteral extends NodeBase<"Number"> {
  readonly text: string;
  readonly integer: boolean;
}
export interface StringLiteral extends NodeBase<"String"> {
  /** Verbatim, quotes included. */
  readonly text: string;
  /** Unescaped, quotes removed. */
  readonly value: string;
  readonly quote: "'" | '"' | "'''" | '"""' | "/";
}
export interface BooleanLiteral extends NodeBase<"Boolean"> {
  readonly value: boolean;
}
export interface NullLiteral extends NodeBase<"Null"> {}
export interface GString extends NodeBase<"GString"> {
  readonly quote: '"' | '"""';
  readonly parts: readonly (GStringText | Interpolation)[];
}
export interface GStringText extends NodeBase<"GStringText"> {
  readonly text: string;
  readonly value: string;
}
/** The range includes `$` or `${ }`. */
export interface Interpolation extends NodeBase<"Interpolation"> {
  readonly braced: boolean;
  readonly expression: Expression;
}
export interface ListExpr extends NodeBase<"List"> {
  readonly elements: readonly Expression[];
  readonly trailingComma: boolean;
}
export interface MapExpr extends NodeBase<"Map"> {
  readonly entries: readonly MapEntry[];
  readonly trailingComma: boolean;
}
export interface MapEntry extends NodeBase<"MapEntry"> {
  /** An `Identifier` for a bare name or keyword. */
  readonly key: Identifier | Expression;
  readonly value: Expression;
}
export interface Closure extends NodeBase<"Closure"> {
  /** `null`: no `->`. */
  readonly params: readonly FormalParameter[] | null;
  readonly body: readonly Statement[];
}
export interface PropertyExpr extends NodeBase<"Property"> {
  readonly object: Expression;
  readonly navigation: Navigation;
  readonly property: Identifier | StringLiteral;
}
export interface IndexExpr extends NodeBase<"Index"> {
  readonly object: Expression;
  readonly indices: readonly Expression[];
}
export type Argument = Expression | NamedArgument;
export interface NamedArgument extends NodeBase<"NamedArgument"> {
  readonly name: Identifier | StringLiteral;
  readonly value: Expression;
}
interface CallArguments {
  /** Source order (upstream moves named arguments first; we don't). */
  readonly args: readonly Argument[];
  /** `false`: a command call `foo a, b`, or a closure only `foo { }`. */
  readonly parens: boolean;
  readonly trailingComma: boolean;
  /** Written after the parentheses, or alone. */
  readonly closures: readonly Closure[];
}
export interface MethodCall extends NodeBase<"MethodCall">, CallArguments {
  /** `null`: implicit `this`. */
  readonly receiver: Expression | null;
  readonly navigation: Navigation | null;
  readonly method: Identifier | StringLiteral;
}
/** `<expr>(...)`, upstream `.call`. */
export interface CallExpr extends NodeBase<"Call">, CallArguments {
  readonly callee: Expression;
}
export interface NewExpr extends NodeBase<"New"> {
  readonly type: TypeRef;
  readonly args: readonly Argument[];
  readonly trailingComma: boolean;
}
export type UnaryOperator = "!" | "~" | "+" | "-";
export interface UnaryExpr extends NodeBase<"Unary"> {
  readonly operator: UnaryOperator;
  readonly operand: Expression;
}
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];
export interface BinaryExpr extends NodeBase<"Binary"> {
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}
export interface CastExpr extends NodeBase<"Cast"> {
  readonly operand: Expression;
  readonly type: TypeRef;
}
export interface TypeTestExpr extends NodeBase<"TypeTest"> {
  readonly operator: "instanceof" | "!instanceof";
  readonly operand: Expression;
  readonly type: TypeRef;
}
export interface TernaryExpr extends NodeBase<"Ternary"> {
  readonly condition: Expression;
  readonly consequent: Expression;
  readonly alternate: Expression;
}
export interface ElvisExpr extends NodeBase<"Elvis"> {
  readonly condition: Expression;
  readonly alternate: Expression;
}
export interface Parenthesized extends NodeBase<"Parenthesized"> {
  readonly expression: Expression;
}
/** `a.` (an error). */
export interface IncompleteExpression extends NodeBase<"IncompleteExpression"> {
  readonly object: Expression;
  readonly navigation: Navigation;
}

// Names and types
export interface TypedName extends NodeBase<"TypedName"> {
  readonly name: Identifier;
  readonly type: TypeRef | null;
}
/** Not `Parameter`: `@nf-builder/lang-core` already exports a catalogue type of that name. The node kind is "Parameter". */
export interface FormalParameter extends NodeBase<"Parameter"> {
  readonly name: Identifier;
  readonly def: boolean;
  readonly type: TypeRef | null;
  readonly legacyType: LegacyType | null;
  readonly defaultValue: Expression | null;
}
export interface TypeRef extends NodeBase<"TypeRef"> {
  /** As written, without spaces: "Path", "java.nio.file.Path", "int". */
  readonly name: string;
  readonly typeArguments: readonly (TypeRef | Wildcard)[];
  readonly nullable: boolean;
}
export interface Wildcard extends NodeBase<"Wildcard"> {}
/** `String[]` */
export interface LegacyType extends NodeBase<"LegacyType"> {
  readonly type: TypeRef;
  readonly dimensions: number;
}

export type ScriptNode =
  | ScriptAst
  | ScriptItem
  | Identifier
  | IncludeEntry
  | Param
  | Section<unknown>
  | RecordInput
  | TupleInput
  | NamedOutput
  | OutputDecl
  | TupleTarget
  | CatchClause
  | Expression
  | GStringText
  | Interpolation
  | MapEntry
  | NamedArgument
  | TypedName
  | FormalParameter
  | TypeRef
  | Wildcard
  | LegacyType;

/** Every node kind once. A type test proves it is exhaustive. */
export const SCRIPT_NODE_KINDS = [
  "Script",
  "Identifier",
  "FeatureFlag",
  "Include",
  "IncludeEntry",
  "Import",
  "ParamsBlock",
  "Param",
  "LegacyParam",
  "Record",
  "Enum",
  "Section",
  "Process",
  "RecordInput",
  "TupleInput",
  "NamedOutput",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Output",
  "Function",
  "IncompleteDeclaration",
  "InvalidDeclaration",
  "Block",
  "ExpressionStatement",
  "VariableDeclaration",
  "Assignment",
  "TupleTarget",
  "If",
  "TryCatch",
  "Catch",
  "Return",
  "Throw",
  "Assert",
  "EmptyStatement",
  "Variable",
  "Number",
  "String",
  "Boolean",
  "Null",
  "GString",
  "GStringText",
  "Interpolation",
  "List",
  "Map",
  "MapEntry",
  "Closure",
  "Property",
  "Index",
  "NamedArgument",
  "MethodCall",
  "Call",
  "New",
  "Unary",
  "Binary",
  "Cast",
  "TypeTest",
  "Ternary",
  "Elvis",
  "Parenthesized",
  "IncompleteExpression",
  "TypedName",
  "Parameter",
  "TypeRef",
  "Wildcard",
  "LegacyType",
] as const satisfies readonly ScriptNode["kind"][];

export const BINARY_OPERATORS = [
  "**",
  "*",
  "/",
  "%",
  "+",
  "-",
  "<<",
  ">>",
  ">>>",
  "..",
  "..<",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "!in",
  "==",
  "!=",
  "<=>",
  "=~",
  "==~",
  "&",
  "^",
  "|",
  "&&",
  "||",
] as const;

export const ASSIGNMENT_OPERATORS = [
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
  ">>>=",
  "?=",
] as const;
