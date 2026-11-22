// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `processDef` and `agentDef` with their sections (Apache-2.0; see ../../../grammar/NOTICE).
//
// A process is typed when `nextflow.enable.types = true` appeared before it (`cx.typesEnabled`). Like upstream, items
// that are invalid in the kind of process they are in are dropped: a legacy input in a typed process, a typed input in
// a legacy process, an invalid emit. `stage:` and `topic:` sections of a legacy process are dropped as well.
import type {
  AgentDef,
  Expression,
  ExpressionStatement,
  NamedOutput,
  ProcessDef,
  ProcessInput,
  RecordInput,
  Section,
  Statement,
  TupleInput,
} from "@nf-builder/lang-core";
import {
  type AgentDefContext,
  AgentDirectivesContext,
  type AgentInputsContext,
  AgentOutputsContext,
  type AgentPromptContext,
  type BlockStatementsContext,
  type ProcessDefContext,
  type ProcessDirectivesContext,
  type ProcessExecContext,
  type ProcessInputContext,
  type ProcessInputsContext,
  ProcessOutputContext,
  type ProcessOutputsContext,
  type ProcessRecordInputContext,
  type ProcessStageContext,
  type ProcessStubContext,
  type ProcessTopicsContext,
  type ProcessTupleInputContext,
  type ProcessWhenContext,
  type WorkflowEmitContext,
} from "../../generated/ScriptParser.ts";
import type { BuildContext } from "./context.ts";
import { expression } from "./expressions.ts";
import {
  directive,
  isEmitExpression,
  labelled,
  statementsRange,
  unlabelled,
  unparen,
  variableStatement,
} from "./sections.ts";
import { blockStatements, statement } from "./statements.ts";
import { checkVariableName, identifier, typedName, typeRef } from "./types.ts";

const last = <T>(items: readonly T[]): T => items[items.length - 1] as T;

/** Upstream's `checkDirective` over each statement of a directive-like section (directives, stage); invalid ones are dropped. */
function directiveSection(
  ctx: ProcessDirectivesContext | AgentDirectivesContext | ProcessStageContext,
  message: string,
  cx: BuildContext,
): ExpressionStatement[] {
  return ctx
    .statement()
    .map((s) => directive(statement(s, cx), message, cx))
    .filter((s) => s !== null);
}

export function processDirectives(
  ctx: ProcessDirectivesContext | AgentDirectivesContext,
  cx: BuildContext,
): Section<ExpressionStatement> {
  const message =
    ctx instanceof AgentDirectivesContext
      ? "Invalid agent directive"
      : "Invalid process directive";
  return unlabelled(cx.range(ctx), directiveSection(ctx, message, cx));
}

export function processStage(
  ctx: ProcessStageContext,
  cx: BuildContext,
): Section<ExpressionStatement> {
  return labelled(
    cx,
    ctx.start as never,
    cx.range(last(ctx.statement())),
    directiveSection(ctx, "Invalid stage directive", cx),
  );
}

export function processTopics(
  ctx: ProcessTopicsContext,
  cx: BuildContext,
): Section<ExpressionStatement> {
  const items: ExpressionStatement[] = [];
  for (const s of ctx.statement()) {
    const item = statement(s, cx);
    if (item.kind !== "ExpressionStatement") {
      cx.error("Invalid process topic statement", item.range);
      continue;
    }
    const e = unparen(item.expression);
    if (e.kind === "Binary" && e.operator === ">>") items.push(item);
    else cx.error("Invalid process topic statement", item.range);
  }
  return labelled(
    cx,
    ctx.start as never,
    cx.range(last(ctx.statement())),
    items,
  );
}

export function processWhen(
  ctx: ProcessWhenContext,
  cx: BuildContext,
): Section<Expression> {
  const condition = expression(ctx.expression(), cx);
  return labelled(cx, ctx.start as never, condition.range, [condition]);
}

/** The script body of a process without a `script:` label. */
export function implicitExec(
  ctx: BlockStatementsContext,
  cx: BuildContext,
): Section<Statement> {
  return unlabelled(statementsRange(ctx, cx), blockStatements(ctx, cx));
}

/** A labelled section of statements: `script:`/`exec:`/`shell:`, `stub:`, `prompt:`. */
export function processStub(
  ctx: ProcessExecContext | ProcessStubContext | AgentPromptContext,
  cx: BuildContext,
): Section<Statement> {
  const body = ctx.blockStatements();
  return labelled(
    cx,
    ctx.start as never,
    statementsRange(body, cx),
    blockStatements(body, cx),
  );
}

// Typed inputs

export function processInput(
  ctx: ProcessInputContext,
  cx: BuildContext,
): ProcessInput | null {
  const single = ctx.statement();
  if (single) {
    // built first, so that its own errors are reported too
    const stmt = statement(single, cx);
    cx.error("Invalid input declaration in typed process", stmt.range);
    return null;
  }
  const ident = ctx.identifier();
  if (ident) {
    const type = ctx.type();
    const node: ProcessInput = {
      kind: "TypedName",
      name: identifier(ident, cx),
      type: type ? typeRef(type, cx) : null,
      range: cx.range(ctx),
    };
    checkVariableName(node.name.name, node.range, cx);
    return node;
  }
  const record = ctx.processRecordInput();
  if (record) return recordInput(record, cx);
  const tuple = ctx.processTupleInput();
  if (tuple) return tupleInput(tuple, cx);
  return null;
}

export function recordInput(
  ctx: ProcessRecordInputContext,
  cx: BuildContext,
): RecordInput {
  return {
    kind: "RecordInput",
    fields: ctx.nameTypePair().map((p) => typedName(p, cx)),
    trailingComma: ctx.COMMA().length === ctx.nameTypePair().length,
    range: cx.range(ctx),
  };
}

export function tupleInput(
  ctx: ProcessTupleInputContext,
  cx: BuildContext,
): TupleInput {
  const node: TupleInput = {
    kind: "TupleInput",
    components: ctx.nameTypePair().map((p) => typedName(p, cx)),
    trailingComma: ctx.COMMA().length === ctx.nameTypePair().length,
    range: cx.range(ctx),
  };
  if (node.components.length === 1)
    cx.error(
      "Process tuple input must have more than one component",
      node.range,
    );
  return node;
}

export function typedInputs(
  ctx: ProcessInputsContext | AgentInputsContext,
  cx: BuildContext,
): Section<ProcessInput> {
  const items: ProcessInput[] = [];
  for (const input of ctx.processInput()) {
    const item = processInput(input, cx);
    if (item) items.push(item);
  }
  return labelled(
    cx,
    ctx.start as never,
    cx.range(last(ctx.processInput())),
    items,
  );
}

// Legacy inputs

const TYPED_INPUT_IN_LEGACY =
  "Typed input declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script";
const TYPED_OUTPUT_IN_LEGACY =
  "Typed output declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script";

function legacyInput(
  ctx: ProcessInputContext,
  cx: BuildContext,
): Statement | null {
  const single = ctx.statement();
  if (single) return statement(single, cx);
  const ident = ctx.identifier();
  // an identifier without a type is a legacy input declaration
  if (ident && !ctx.type()) {
    const range = cx.range(ident);
    checkVariableName(ident.getText(), range, cx);
    return variableStatement(
      { kind: "Variable", name: ident.getText(), range },
      cx.range(ctx),
    );
  }
  cx.error(TYPED_INPUT_IN_LEGACY, cx.range(ctx));
  return null;
}

export function legacyInputs(
  ctx: ProcessInputsContext,
  cx: BuildContext,
): Section<ExpressionStatement> {
  const items: ExpressionStatement[] = [];
  for (const input of ctx.processInput()) {
    const stmt = legacyInput(input, cx);
    const item = stmt ? directive(stmt, "Invalid process input", cx) : null;
    if (item) items.push(item);
  }
  return labelled(
    cx,
    ctx.start as never,
    cx.range(last(ctx.processInput())),
    items,
  );
}

// Outputs

/**
 * A typed output or emit: `name`, `name: Type`, `name = value`, or an expression statement. Anything else that is a
 * statement is dropped.
 */
export function namedOutput(
  ctx: ProcessOutputContext | WorkflowEmitContext,
  cx: BuildContext,
): NamedOutput | ExpressionStatement | null {
  const single = ctx.statement();
  if (single) {
    const stmt = statement(single, cx);
    if (isEmitExpression(stmt)) return stmt as ExpressionStatement;
    cx.error(
      ctx instanceof ProcessOutputContext
        ? "Invalid output declaration in typed process -- must be a name, assignment, or expression"
        : "Invalid workflow emit -- must be a name, assignment, or expression",
      stmt.range,
    );
    return null;
  }
  const pair = ctx.nameTypePair();
  if (!pair) return null;
  const type = pair.type();
  const value = ctx.expression();
  const node: NamedOutput = {
    kind: "NamedOutput",
    name: identifier(pair.identifier(), cx),
    type: type ? typeRef(type, cx) : null,
    value: value ? expression(value, cx) : null,
    range: cx.range(ctx),
  };
  checkVariableName(node.name.name, cx.range(pair), cx);
  return node;
}

export function typedOutputs(
  ctx: ProcessOutputsContext | AgentOutputsContext,
  cx: BuildContext,
): Section<NamedOutput | ExpressionStatement> {
  const items: (NamedOutput | ExpressionStatement)[] = [];
  for (const output of ctx.processOutput()) {
    const item = namedOutput(output, cx);
    if (item) items.push(item);
  }
  if (ctx instanceof AgentOutputsContext) {
    if (items.length > 1)
      cx.error(
        "Agent should have only one output -- combine outputs into a record",
        cx.range(ctx),
      );
  } else if (
    items.length > 1 &&
    items.some((item) => item.kind === "ExpressionStatement")
  )
    cx.error(
      "Every output must be assigned to a name when there are multiple outputs",
      cx.range(ctx),
    );
  return labelled(
    cx,
    ctx.start as never,
    cx.range(last(ctx.processOutput())),
    items,
  );
}

function legacyOutput(
  ctx: ProcessOutputContext,
  cx: BuildContext,
): Statement | null {
  const single = ctx.statement();
  if (single) return statement(single, cx);
  const pair = ctx.nameTypePair();
  // a name with no type and no source expression is a legacy output declaration
  if (pair && !pair.type() && !ctx.expression()) {
    const range = cx.range(pair.identifier());
    checkVariableName(pair.identifier().getText(), range, cx);
    return variableStatement(
      { kind: "Variable", name: pair.identifier().getText(), range },
      cx.range(ctx),
    );
  }
  cx.error(TYPED_OUTPUT_IN_LEGACY, cx.range(ctx));
  return null;
}

export function legacyOutputs(
  ctx: ProcessOutputsContext,
  cx: BuildContext,
): Section<ExpressionStatement> {
  const items: ExpressionStatement[] = [];
  for (const output of ctx.processOutput()) {
    const stmt = legacyOutput(output, cx);
    const item = stmt ? directive(stmt, "Invalid process output", cx) : null;
    if (item) items.push(item);
  }
  return labelled(
    cx,
    ctx.start as never,
    cx.range(last(ctx.processOutput())),
    items,
  );
}

// Definitions

type Sections = Record<string, Section<unknown> | null>;

/** The sections as properties in source order (the explicit `exec` form puts outputs after the script), then the empty ones. */
function inSourceOrder(sections: Sections): Sections {
  const entries = Object.entries(sections);
  const present = entries
    .filter(([, s]) => s !== null)
    .sort(
      ([, a], [, b]) =>
        (a as Section<unknown>).range.start -
        (b as Section<unknown>).range.start,
    );
  return Object.fromEntries([
    ...present,
    ...entries.filter(([, s]) => s === null),
  ]);
}

/** The outputs a legacy process keeps upstream: statements, and names without a type or a source. */
const legacyOutputsKept = (ctx: ProcessOutputsContext) =>
  ctx
    .processOutput()
    .filter(
      (o) =>
        o.statement() !== null ||
        (o.nameTypePair() && !o.nameTypePair()?.type() && !o.expression()),
    ).length;

export function processDef(
  ctx: ProcessDefContext,
  cx: BuildContext,
): ProcessDef {
  const name = identifier(ctx._name as never, cx);
  const range = cx.range(ctx);
  const typed = cx.typesEnabled;
  const body = ctx._body;
  const sections: Sections = {
    directives: null,
    inputs: null,
    outputs: null,
    when: null,
    exec: null,
    stub: null,
  };

  if (body) {
    const dir = body.processDirectives();
    if (dir) sections.directives = processDirectives(dir, cx);
    const inputs = body.processInputs();
    if (inputs)
      sections.inputs = typed
        ? typedInputs(inputs, cx)
        : legacyInputs(inputs, cx);
    // upstream builds the typed-only sections whether or not types are enabled, so their errors are reported
    const stage = body.processStage();
    const stageSection = stage ? processStage(stage, cx) : null;
    if (typed) sections.stage = stageSection;
    else if (stage)
      cx.error(
        "The `stage:` section is not supported in a legacy process",
        cx.range(stage),
      );
    const outputs = body.processOutputs();
    if (outputs)
      sections.outputs = typed
        ? typedOutputs(outputs, cx)
        : legacyOutputs(outputs, cx);
    const topics = body.processTopics();
    const topicSection = topics ? processTopics(topics, cx) : null;
    if (typed) sections.topics = topicSection;
    else if (topics)
      cx.error(
        "The `topic:` section is not supported in a legacy process",
        cx.range(topics),
      );
    const when = body.processWhen();
    if (when) sections.when = processWhen(when, cx);
    const exec = body.processExec();
    const implicit = body.blockStatements();
    if (exec) sections.exec = processStub(exec, cx);
    else if (implicit) sections.exec = implicitExec(implicit, cx);
    const stub = body.processStub();
    if (stub) sections.stub = processStub(stub, cx);

    if (implicit) {
      const outputsKept = !outputs
        ? 0
        : typed
          ? (sections.outputs as Section<unknown>).items.length
          : legacyOutputsKept(outputs);
      if (
        (dir?.statement().length ?? 0) > 0 ||
        inputs ||
        outputsKept > 0 ||
        (topicSection?.items.length ?? 0) > 0
      )
        cx.error(
          "The `script:` or `exec:` label is required when other sections are present",
          statementsRange(implicit, cx),
        );
    }
  } else {
    cx.error("Missing process script body", range);
  }

  // a typed process without a body still has the typed sections, as `null`
  if (typed && !body) {
    sections.stage = null;
    sections.topics = null;
  }
  return {
    kind: "Process",
    typed,
    name,
    ...inSourceOrder(sections),
    range,
  } as unknown as ProcessDef;
}

export function agentDef(ctx: AgentDefContext, cx: BuildContext): AgentDef {
  const name = identifier(ctx._name as never, cx);
  const range = cx.range(ctx);
  const body = ctx._body;
  if (!body) cx.error("Missing agent body", range);
  const dir = body?.agentDirectives();
  const inputs = body?.agentInputs();
  const outputs = body?.agentOutputs();
  const prompt = body?.agentPrompt();
  return {
    kind: "Agent",
    name,
    directives: dir ? processDirectives(dir, cx) : null,
    inputs: inputs ? typedInputs(inputs, cx) : null,
    outputs: outputs ? typedOutputs(outputs, cx) : null,
    prompt: prompt ? processStub(prompt, cx) : null,
    range,
  };
}
