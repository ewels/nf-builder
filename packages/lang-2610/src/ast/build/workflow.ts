// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `workflowDef` and its sections (Apache-2.0; see ../../../grammar/NOTICE). Items that are invalid in the kind of
// workflow they are in are dropped, as upstream does: a statement as a take, a typed take or typed emit in a legacy
// workflow, a publisher that is not an assignment.
import type {
  ExpressionStatement,
  NamedOutput,
  Section,
  Statement,
  TypedName,
  WorkflowDef,
} from "@nf-builder/lang-core";
import type { Token } from "antlr4ng";
import type {
  BlockStatementsContext,
  WorkflowDefContext,
  WorkflowEmitContext,
  WorkflowEmitsContext,
  WorkflowPublishersContext,
  WorkflowTakeContext,
  WorkflowTakesContext,
} from "../../generated/ScriptParser.ts";
import type { BuildContext } from "./context.ts";
import { expression } from "./expressions.ts";
import { namedOutput } from "./process.ts";
import { labelled, statementsRange, unlabelled } from "./sections.ts";
import { blockStatements } from "./statements.ts";
import { checkVariableName, identifier, typeRef } from "./types.ts";

const last = <T>(items: readonly T[]): T => items[items.length - 1] as T;

function take(ctx: WorkflowTakeContext, cx: BuildContext): TypedName | null {
  const ident = ctx.identifier();
  if (!ident) {
    // upstream reports the statement without building it
    cx.error("Invalid workflow take", cx.range(ctx.statement() as never));
    return null;
  }
  const type = ctx.type();
  if (!cx.typesEnabled && type) {
    cx.error(
      "Typed input is not allowed in legacy workflow -- set `nextflow.enable.types = true` to use typed workflows in this script",
      cx.range(ctx),
    );
    return null;
  }
  const node: TypedName = {
    kind: "TypedName",
    name: identifier(ident, cx),
    type: type ? typeRef(type, cx) : null,
    range: cx.range(ctx),
  };
  checkVariableName(node.name.name, node.range, cx);
  return node;
}

export function workflowTakes(
  ctx: WorkflowTakesContext,
  label: Token,
  cx: BuildContext,
): Section<TypedName> {
  const items: TypedName[] = [];
  for (const t of ctx.workflowTake()) {
    const item = take(t, cx);
    if (item) items.push(item);
  }
  return labelled(cx, label, cx.range(last(ctx.workflowTake())), items);
}

function emit(
  ctx: WorkflowEmitContext,
  cx: BuildContext,
): NamedOutput | ExpressionStatement | null {
  const item = namedOutput(ctx, cx);
  if (item && !cx.typesEnabled && ctx.nameTypePair()?.type()) {
    cx.error(
      "Typed output is not allowed in legacy workflow -- set `nextflow.enable.types = true` to use typed workflows in this script",
      cx.range(ctx),
    );
    return null;
  }
  return item;
}

export function workflowEmits(
  ctx: WorkflowEmitsContext,
  label: Token,
  cx: BuildContext,
): Section<NamedOutput | ExpressionStatement> {
  const items: (NamedOutput | ExpressionStatement)[] = [];
  for (const e of ctx.workflowEmit()) {
    const item = emit(e, cx);
    if (item) items.push(item);
  }
  if (
    items.length > 1 &&
    items.some((item) => item.kind === "ExpressionStatement")
  )
    cx.error(
      "Every emit must be assigned to a name when there are multiple emits",
      cx.range(ctx),
    );
  return labelled(cx, label, cx.range(last(ctx.workflowEmit())), items);
}

function publisher(
  ctx: WorkflowEmitContext,
  cx: BuildContext,
): NamedOutput | null {
  const message = "Invalid workflow publish statement -- must be an assignment";
  const pair = ctx.nameTypePair();
  if (!pair) {
    // upstream reports the statement without building it
    cx.error(message, cx.range(ctx.statement() as never));
    return null;
  }
  const pairRange = cx.range(pair);
  checkVariableName(pair.identifier().getText(), pairRange, cx);
  const value = ctx.expression();
  if (!value) {
    cx.error(message, pairRange);
    return null;
  }
  const type = pair.type();
  return {
    kind: "NamedOutput",
    name: identifier(pair.identifier(), cx),
    type: type ? typeRef(type, cx) : null,
    value: expression(value, cx),
    range: cx.range(ctx),
  };
}

export function workflowPublishers(
  ctx: WorkflowPublishersContext,
  label: Token,
  cx: BuildContext,
): Section<NamedOutput> {
  const items: NamedOutput[] = [];
  for (const e of ctx.workflowEmit()) {
    const item = publisher(e, cx);
    if (item) items.push(item);
  }
  return labelled(cx, label, cx.range(last(ctx.workflowEmit())), items);
}

function blockSection(
  ctx: BlockStatementsContext | undefined,
  label: Token | null | undefined,
  cx: BuildContext,
): Section<Statement> | null {
  if (!ctx) return null;
  const items = blockStatements(ctx, cx);
  const range = statementsRange(ctx, cx);
  return label ? labelled(cx, label, range, items) : unlabelled(range, items);
}

export function workflowDef(
  ctx: WorkflowDefContext,
  cx: BuildContext,
): WorkflowDef {
  const body = ctx._body;
  const name = ctx._name;
  const takes = body?._take;
  const emits = body?._emit;
  const publishers = body?._publish;
  const node: WorkflowDef = {
    kind: "Workflow",
    name: name ? identifier(name, cx) : null,
    typed: cx.typesEnabled,
    takes:
      body && takes
        ? workflowTakes(takes, (body.TAKE() as { symbol: Token }).symbol, cx)
        : null,
    // `main:` is absent in an implicit main block
    main: blockSection(body?._main, body?.MAIN()?.symbol, cx),
    emits:
      body && emits
        ? workflowEmits(emits, (body.EMIT() as { symbol: Token }).symbol, cx)
        : null,
    publishers:
      body && publishers
        ? workflowPublishers(
            publishers,
            (body.PUBLISH() as { symbol: Token }).symbol,
            cx,
          )
        : null,
    onComplete: blockSection(body?._onComplete, body?.ONCOMPLETE()?.symbol, cx),
    onError: blockSection(body?._onError, body?.ONERROR()?.symbol, cx),
    range: cx.range(ctx),
  };
  if (body && !name) {
    if (takes)
      cx.error(
        "Entry workflow cannot have a take section",
        cx.tokenRange((body.TAKE() as { symbol: Token }).symbol),
      );
    if (emits)
      cx.error(
        "Entry workflow cannot have an emit section",
        cx.tokenRange((body.EMIT() as { symbol: Token }).symbol),
      );
  }
  if (body && name) {
    // upstream reports the section's block; for onError it passes onComplete's by mistake (lint prints -1:-1), so every
    // section is reported at its first item
    if (publishers)
      cx.error(
        "Named workflow cannot have a publish section",
        cx.range(publishers),
      );
    if (body._onComplete)
      cx.error(
        "Named workflow cannot have an onComplete section",
        statementsRange(body._onComplete, cx),
      );
    if (body._onError)
      cx.error(
        "Named workflow cannot have an onError section",
        statementsRange(body._onError, cx),
      );
  }
  return node;
}
