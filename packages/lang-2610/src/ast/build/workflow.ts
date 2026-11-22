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
import { identifier, typeRef } from "./types.ts";

const last = <T>(items: readonly T[]): T => items[items.length - 1] as T;

function take(ctx: WorkflowTakeContext, cx: BuildContext): TypedName | null {
  const ident = ctx.identifier();
  if (!ident) return null;
  const type = ctx.type();
  if (!cx.typesEnabled && type) return null;
  return {
    kind: "TypedName",
    name: identifier(ident, cx),
    type: type ? typeRef(type, cx) : null,
    range: cx.range(ctx),
  };
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
  if (!cx.typesEnabled && ctx.nameTypePair()?.type()) return null;
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
  return labelled(cx, label, cx.range(last(ctx.workflowEmit())), items);
}

function publisher(
  ctx: WorkflowEmitContext,
  cx: BuildContext,
): NamedOutput | null {
  const pair = ctx.nameTypePair();
  const value = ctx.expression();
  if (!pair || !value) return null;
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
  return {
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
}
