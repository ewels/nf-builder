// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/
// ScriptFormattingVisitor.java (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE). The line numbers in
// the comments are upstream's. Left out: Harshil alignment, `maheshForm` and declaration sorting, none of which is a
// default of `nextflow lint -format` (plan F-110 open point 5). One rule is added for nodes an edit created (plan 4.3).
import {
  type AgentDef,
  type Block,
  type Closure,
  type Declaration,
  type EnumDef,
  type ExpressionStatement,
  type FeatureFlag,
  type FunctionDef,
  hasPosition,
  type Include,
  type LegacyParam,
  type LegacyProcess,
  type MethodCall,
  type NamedOutput,
  type OutputBlock,
  type OutputDecl,
  type ParamsBlock,
  PrintError,
  type ProcessDef,
  type ProcessInput,
  type RecordDef,
  type ScriptAst,
  type ScriptItem,
  type Section,
  type Statement,
  type TypedName,
  type TypedProcess,
  type WorkflowDef,
} from "@nf-builder/lang-core";
import type { Formatter } from "./formatter.ts";
import { lastLine, line } from "./positions.ts";
import { hasLegacyType, hasType } from "./types.ts";

const DECLARATIONS: ReadonlySet<string> = new Set([
  "FeatureFlag",
  "Include",
  "Import",
  "ParamsBlock",
  "LegacyParam",
  "Record",
  "Enum",
  "Process",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Function",
  "IncompleteDeclaration",
]);

export const isDeclaration = (item: ScriptItem): item is Declaration =>
  DECLARATIONS.has(item.kind);

const items = <T>(section: Section<T> | null): readonly T[] =>
  section ? section.items : [];

/** `asMethodCallX`: the call an expression statement is made of, if it is one. */
const callOf = (stmt: Statement): MethodCall | null =>
  stmt.kind === "ExpressionStatement" && stmt.expression.kind === "MethodCall"
    ? stmt.expression
    : null;

export class ScriptFormatter {
  constructor(private readonly fmt: Formatter) {}

  /** The whole script (L93): the shebang, a code snippet or the declarations, and the script's dangling comments. */
  script(ast: ScriptAst): void {
    const fmt = this.fmt;
    if (ast.shebang) {
      fmt.append(ast.shebang.text);
      fmt.appendNewLine();
    }

    for (const item of ast.body)
      if (item.kind === "InvalidDeclaration")
        throw new PrintError("invalid declaration", item);
    const declarations = ast.body.filter(isDeclaration);
    const statements = ast.body.filter(
      (item): item is Statement =>
        !isDeclaration(item) && item.kind !== "InvalidDeclaration",
    );
    if (statements.length > 0 && declarations.length > 0)
      throw new PrintError(
        "a script cannot mix top-level statements and declarations",
        statements[0] as Statement,
      );

    if (statements.length > 0) {
      // a code snippet
      fmt.statements(statements, null);
    } else {
      let previous: Declaration | null = null;
      for (const node of declarations) {
        this.declaration(node, previous);
        previous = node;
      }
    }
    fmt.appendDanglingComments(ast);
  }

  /**
   * One declaration (L132). `previous` is the declaration before it in the script, if any. Upstream prints blank lines
   * only from the source layout, which a node an edit created (`NO_RANGE`) doesn't have: it gets one blank line before
   * it, except after the previous declaration when both are includes or both are feature flags (plan 4.3).
   */
  declaration(node: Declaration, previous: Declaration | null): void {
    if (
      previous !== null &&
      !hasPosition(node.range) &&
      !(previous.kind === "Include" && node.kind === "Include") &&
      !(previous.kind === "FeatureFlag" && node.kind === "FeatureFlag")
    )
      this.fmt.appendNewLine();

    switch (node.kind) {
      case "Agent":
        this.agent(node);
        break;
      case "Enum":
        this.enumDef(node);
        break;
      case "FeatureFlag":
        this.featureFlag(node);
        break;
      case "Function":
        this.func(node);
        break;
      case "Include":
        this.include(node);
        break;
      case "OutputBlock":
        this.outputs(node);
        break;
      case "ParamsBlock":
        this.params(node);
        break;
      case "LegacyParam":
        this.paramV1(node);
        break;
      case "Process":
        if (node.typed) this.processV2(node);
        else this.processV1(node);
        break;
      case "Record":
        this.record(node);
        break;
      case "Workflow":
        this.workflow(node);
        break;
      case "Import":
        throw new PrintError("import declarations are not supported", node);
      case "IncompleteDeclaration":
        throw new PrintError("incomplete declaration", node);
    }
  }

  /** L167 */
  private featureFlag(node: FeatureFlag): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append(node.name.name);
    fmt.append(" = ");
    fmt.expression(node.value);
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L177 */
  private include(node: Include): void {
    const fmt = this.fmt;
    const wrap = line(node) < lastLine(node);
    fmt.appendLeadingComments(node);
    fmt.append("include {");
    if (wrap) fmt.incIndent();
    for (const [i, entry] of node.entries.entries()) {
      if (wrap) {
        fmt.appendNewLine();
        fmt.appendIndent();
      } else {
        fmt.append(" ");
      }
      fmt.append(entry.name.name);
      if (entry.alias) {
        fmt.append(" as ");
        fmt.append(entry.alias.name);
      }
      if (i + 1 < node.entries.length) fmt.append(" ;");
    }
    if (wrap) {
      fmt.appendNewLine();
      fmt.decIndent();
    } else {
      fmt.append(" ");
    }
    fmt.append("} from ");
    fmt.expression(node.source);
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L224 */
  private params(node: ParamsBlock): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("params {\n");
    fmt.incIndent();
    for (const param of node.params) {
      fmt.appendLeadingComments(param);
      fmt.appendIndent();
      fmt.append(param.name.name);
      if (hasType(param.type)) {
        fmt.append(": ");
        fmt.typeAnnotation(param.type);
      }
      if (param.defaultValue) {
        fmt.append(" = ");
        fmt.expression(param.defaultValue);
      }
      fmt.appendTrailingComment(param);
      fmt.appendNewLine();
    }
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L255 */
  private paramV1(node: LegacyParam): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.appendIndent();
    fmt.expression(node.target);
    fmt.append(" = ");
    fmt.expression(node.value);
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L276 */
  private workflow(node: WorkflowDef): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("workflow");
    if (node.name) {
      fmt.append(" ");
      fmt.append(node.name.name);
    }
    fmt.append(" {\n");
    fmt.incIndent();
    const takes = items(node.takes);
    const main = items(node.main);
    const emits = items(node.emits);
    const publishers = items(node.publishers);
    const onComplete = items(node.onComplete);
    const onError = items(node.onError);
    if (takes.length > 0) {
      fmt.appendIndent();
      fmt.append("take:\n");
      this.typedInputs(takes);
    }
    if (main.length > 0) {
      if (
        takes.length > 0 ||
        emits.length > 0 ||
        publishers.length > 0 ||
        onComplete.length > 0 ||
        onError.length > 0
      ) {
        fmt.appendNewLine();
        fmt.appendIndent();
        fmt.append("main:\n");
      }
      fmt.statements(main, null);
    }
    if (emits.length > 0) {
      fmt.appendNewLine();
      fmt.appendIndent();
      fmt.append("emit:\n");
      this.typedOutputs(emits);
    }
    if (publishers.length > 0) {
      fmt.appendNewLine();
      fmt.appendIndent();
      fmt.append("publish:\n");
      this.workflowPublishers(publishers);
    }
    if (onComplete.length > 0) {
      fmt.appendNewLine();
      fmt.appendIndent();
      fmt.append("onComplete:\n");
      fmt.statements(onComplete, null);
    }
    if (onError.length > 0) {
      fmt.appendNewLine();
      fmt.appendIndent();
      fmt.append("onError:\n");
      fmt.statements(onError, null);
    }
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L330 */
  private typedInputs(inputs: readonly ProcessInput[]): void {
    const fmt = this.fmt;
    for (const input of inputs) {
      fmt.appendLeadingComments(input);
      fmt.appendIndent();
      if (input.kind === "TypedName") this.typedInput(input);
      else this.structuredInput(input);
      fmt.appendTrailingComment(input);
      fmt.appendNewLine();
    }
  }

  /** L349: a `record(...)` always wraps, a `tuple(...)` never does; there is no trailing comma. */
  private structuredInput(
    input: Exclude<ProcessInput, { kind: "TypedName" }>,
  ): void {
    const fmt = this.fmt;
    const isRecord = input.kind === "RecordInput";
    const components = isRecord ? input.fields : input.components;
    fmt.append(isRecord ? "record" : "tuple");
    fmt.append("(");
    if (isRecord) fmt.incIndent();
    for (const [i, p] of components.entries()) {
      if (isRecord) {
        fmt.appendNewLine();
        fmt.appendIndent();
      }
      this.typedInput(p);
      if (i < components.length - 1) fmt.append(isRecord ? "," : ", ");
    }
    if (isRecord) {
      fmt.appendNewLine();
      fmt.decIndent();
      fmt.appendIndent();
    }
    fmt.append(")");
  }

  /** L379 */
  private typedInput(node: TypedName): void {
    this.fmt.append(node.name.name);
    if (hasType(node.type)) {
      this.fmt.append(": ");
      this.fmt.typeAnnotation(node.type);
    }
  }

  /** L387 */
  private typedOutputs(
    outputs: readonly (NamedOutput | ExpressionStatement)[],
  ): void {
    const fmt = this.fmt;
    for (const stmt of outputs) {
      if (stmt.kind === "NamedOutput") {
        fmt.appendLeadingComments(stmt);
        fmt.appendIndent();
        this.outputAssignment(stmt);
        fmt.appendTrailingComment(stmt);
        fmt.appendNewLine();
      } else {
        fmt.statement(stmt);
      }
    }
  }

  /** L420: a publish target drops its type. */
  private workflowPublishers(publishers: readonly NamedOutput[]): void {
    const fmt = this.fmt;
    for (const stmt of publishers) {
      fmt.appendLeadingComments(stmt);
      fmt.appendIndent();
      fmt.append(stmt.name.name);
      fmt.append(" = ");
      if (stmt.value) fmt.expression(stmt.value);
      fmt.appendTrailingComment(stmt);
      fmt.appendNewLine();
    }
  }

  /** L472 */
  private outputAssignment(node: NamedOutput): void {
    const fmt = this.fmt;
    fmt.append(node.name.name);
    if (hasType(node.type)) {
      fmt.append(": ");
      fmt.typeAnnotation(node.type);
    }
    if (node.value) {
      fmt.append(" = ");
      fmt.expression(node.value);
    }
  }

  /** L489 */
  private agent(node: AgentDef): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("agent ");
    fmt.append(node.name.name);
    fmt.append(" {\n");
    fmt.incIndent();
    if (items(node.directives).length > 0) {
      this.directives(items(node.directives));
      fmt.appendNewLine();
    }
    const inputs = items(node.inputs);
    if (inputs.length > 0) {
      fmt.appendIndent();
      fmt.append("input:\n");
      this.typedInputs(inputs);
      fmt.appendNewLine();
    }
    if (items(node.outputs).length > 0) {
      this.processOutputs(items(node.outputs));
      fmt.appendNewLine();
    }
    fmt.appendIndent();
    fmt.append("prompt:\n");
    fmt.statements(items(node.prompt), null);
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L521 */
  private processV2(node: TypedProcess): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("process ");
    fmt.append(node.name.name);
    fmt.append(" {\n");
    fmt.incIndent();
    if (items(node.directives).length > 0) {
      this.directives(items(node.directives));
      fmt.appendNewLine();
    }
    const inputs = items(node.inputs);
    if (inputs.length > 0) {
      fmt.appendIndent();
      fmt.append("input:\n");
      this.typedInputs(inputs);
      fmt.appendNewLine();
    }
    if (items(node.stage).length > 0) {
      fmt.appendIndent();
      fmt.append("stage:\n");
      this.directives(items(node.stage));
      fmt.appendNewLine();
    }
    if (items(node.outputs).length > 0) {
      this.processOutputs(items(node.outputs));
      fmt.appendNewLine();
    }
    if (items(node.topics).length > 0) {
      fmt.appendIndent();
      fmt.append("topic:\n");
      fmt.statements(items(node.topics), null);
      fmt.appendNewLine();
    }
    this.processBody(node);
  }

  /** The `when:`, `script:` (or `exec:`, `shell:`) and `stub:` sections and the closing brace of a process. */
  private processBody(node: ProcessDef): void {
    const fmt = this.fmt;
    const when = node.when?.items[0];
    if (when) {
      fmt.appendIndent();
      fmt.append("when:\n");
      fmt.appendIndent();
      fmt.expression(when);
      fmt.append("\n\n");
    }
    fmt.appendIndent();
    // an implicit script body is printed with its label
    fmt.append(node.exec?.label ?? "script");
    fmt.append(":\n");
    fmt.statements(items(node.exec), null);
    if (items(node.stub).length > 0) {
      fmt.appendNewLine();
      fmt.appendIndent();
      fmt.append("stub:\n");
      fmt.statements(items(node.stub), null);
    }
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L588 */
  private processOutputs(
    outputs: readonly (NamedOutput | ExpressionStatement)[],
  ): void {
    this.fmt.appendIndent();
    this.fmt.append("output:\n");
    this.typedOutputs(outputs);
  }

  /** L601 */
  private processV1(node: LegacyProcess): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("process ");
    fmt.append(node.name.name);
    fmt.append(" {\n");
    fmt.incIndent();
    if (items(node.directives).length > 0) {
      this.directives(items(node.directives));
      fmt.appendNewLine();
    }
    if (items(node.inputs).length > 0) {
      fmt.appendIndent();
      fmt.append("input:\n");
      this.directives(items(node.inputs));
      fmt.appendNewLine();
    }
    if (items(node.outputs).length > 0) {
      fmt.appendIndent();
      fmt.append("output:\n");
      this.directives(items(node.outputs));
      fmt.appendNewLine();
    }
    this.processBody(node);
  }

  /** L656 */
  private func(node: FunctionDef): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append(`def ${node.name.name}(`);
    fmt.parameters(node.params);
    fmt.append(")");
    if (hasLegacyType(node.legacyReturnType)) {
      fmt.append(" -> ");
      fmt.legacyTypeAnnotation(node.legacyReturnType);
    } else if (hasType(node.returnType)) {
      fmt.append(" -> ");
      fmt.typeAnnotation(node.returnType);
    }
    fmt.append(" {\n");
    fmt.incIndent();
    fmt.statements(node.body.statements, null);
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L678 */
  private record(node: RecordDef): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("record ");
    fmt.append(node.name.name);
    fmt.append(" {\n");
    fmt.incIndent();
    for (const field of node.fields) {
      fmt.appendLeadingComments(field);
      fmt.appendIndent();
      this.typedInput(field);
      fmt.appendTrailingComment(field);
      fmt.appendNewLine();
    }
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.appendIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L712: one constant per line, each with a comma. */
  private enumDef(node: EnumDef): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("enum ");
    fmt.append(node.name.name);
    fmt.append(" {\n");
    fmt.incIndent();
    for (const constant of node.constants) {
      fmt.appendLeadingComments(constant);
      fmt.appendIndent();
      fmt.append(constant.name);
      fmt.append(",");
      fmt.appendTrailingComment(constant);
      fmt.appendNewLine();
    }
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L734 */
  private outputs(node: OutputBlock): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.append("output {\n");
    fmt.incIndent();
    for (const output of node.outputs) this.output(output);
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L747 */
  private output(node: OutputDecl): void {
    const fmt = this.fmt;
    fmt.appendLeadingComments(node);
    fmt.appendIndent();
    fmt.append(node.name.name);
    if (hasType(node.type)) {
      fmt.append(": ");
      fmt.typeAnnotation(node.type);
    }
    fmt.append(" {\n");
    fmt.incIndent();
    this.outputBody(node.body);
    fmt.appendDanglingComments(node);
    fmt.decIndent();
    fmt.appendIndent();
    fmt.append("}");
    fmt.appendTrailingComment(node);
    fmt.appendNewLine();
  }

  /** L766 */
  private outputBody(block: Block): void {
    const fmt = this.fmt;
    for (const stmt of block.statements) {
      const call = callOf(stmt);
      if (call === null) continue;

      // treat as index definition
      const name =
        call.method.kind === "Identifier"
          ? call.method.name
          : call.method.value;
      const closures: readonly Closure[] = call.closures;
      const args = call.args;
      const closure =
        name === "index" && args.length === 0 && closures.length === 1
          ? (closures[0] as Closure)
          : name === "index" &&
              args.length === 1 &&
              closures.length === 0 &&
              args[0]?.kind === "Closure"
            ? args[0]
            : null;
      if (closure) {
        fmt.appendLeadingComments(stmt);
        fmt.appendIndent();
        fmt.append(name);
        fmt.append(" {\n");
        fmt.incIndent();
        this.directives(closure.body);
        fmt.appendDanglingComments(closure);
        fmt.decIndent();
        fmt.appendIndent();
        fmt.append("}");
        fmt.appendTrailingComment(stmt);
        fmt.appendNewLine();
        continue;
      }

      // treat as regular directive
      fmt.appendLeadingComments(stmt);
      fmt.directive(stmt, call);
    }
  }

  /** L800 */
  private directives(statements: readonly Statement[]): void {
    const fmt = this.fmt;
    for (const stmt of statements) {
      const call = callOf(stmt);
      if (call === null) continue;
      fmt.appendLeadingComments(stmt);
      fmt.directive(stmt, call);
    }
  }
}
