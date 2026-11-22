// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java
// `type`, `typeArguments`, `legacyType`, `formalParameter`, `nameTypePair` (Apache-2.0; see ../../../grammar/NOTICE).
// The builders in this file read only rules the script and config grammars share, so both can drive them (see alt.ts).
import type {
  FormalParameter,
  Identifier,
  LegacyType,
  Range,
  TypedName,
  TypeRef,
  Wildcard,
} from "@nf-builder/lang-core";
import type {
  CreatedNameContext,
  FormalParameterContext,
  IdentifierContext,
  KeywordsContext,
  LegacyTypeContext,
  NameTypePairContext,
  QualifiedClassNameContext,
  TypeArgumentsContext,
  TypeContext,
} from "../../generated/ScriptParser.ts";
import { has } from "./alt.ts";
import type { BuildContext } from "./context.ts";
import { expression } from "./expressions.ts";

const GROOVY_KEYWORDS = new Set([
  "abstract",
  "assert",
  "break",
  "case",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "extends",
  "final",
  "finally",
  "for",
  "goto",
  "implements",
  "interface",
  "native",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "super",
  "switch",
  "synchronized",
  "this",
  "throws",
  "transient",
  "void",
  "volatile",
  "while",
]);

/**
 * Upstream's `checkInvalidVarName`, called wherever a name is declared and on every identifier used as a value. It also
 * explains the removed Groovy statements: a `for` or `switch` statement parses as a call of a name that is a keyword.
 */
export function checkVariableName(
  name: string,
  at: Range,
  cx: BuildContext,
): void {
  if (name === "_")
    cx.error(
      "`_` is not allowed as an identifier because it is reserved for future use",
      at,
    );
  if (!GROOVY_KEYWORDS.has(name)) return;
  if (name === "for" || name === "while")
    cx.error(`\`${name}\` loops are no longer supported`, at);
  else if (name === "switch")
    cx.error("`switch` statements are no longer supported", at);
  else
    cx.error(
      `\`${name}\` is not allowed as an identifier because it is a Groovy keyword`,
      at,
    );
}

export function identifier(
  ctx: IdentifierContext | KeywordsContext,
  cx: BuildContext,
): Identifier {
  return { kind: "Identifier", name: ctx.getText(), range: cx.range(ctx) };
}

function typeArguments(
  ctx: TypeArgumentsContext | null,
  cx: BuildContext,
): (TypeRef | Wildcard)[] {
  if (!ctx) return [];
  // The config grammar's `typeArguments` lists plain types; the script grammar's allows `?`.
  if (!has<TypeArgumentsContext>(ctx, "typeArgument"))
    return (ctx as unknown as { type(): TypeContext[] })
      .type()
      .map((t) => typeRef(t, cx));
  return ctx.typeArgument().map((arg) => {
    const type = arg.type();
    return type
      ? typeRef(type, cx)
      : ({ kind: "Wildcard", range: cx.range(arg) } satisfies Wildcard);
  });
}

/** A type as written: `Path`, `java.nio.file.Path`, `int`, `Map<String, ?>`, `Path?`; also the type of `new T<...>(...)`. */
export function typeRef(
  ctx: TypeContext | CreatedNameContext,
  cx: BuildContext,
): TypeRef {
  const primitive = ctx.primitiveType();
  const qualified = ctx.qualifiedClassName();
  return {
    kind: "TypeRef",
    name: (primitive ?? qualified)?.getText() ?? ctx.getText(),
    typeArguments: typeArguments(ctx.typeArguments(), cx),
    nullable: has<TypeContext>(ctx, "QUESTION") && ctx.QUESTION() !== null,
    range: cx.range(ctx),
  };
}

/** A class name without type arguments, as in `catch` clauses. */
export function qualifiedType(
  ctx: QualifiedClassNameContext,
  cx: BuildContext,
): TypeRef {
  return {
    kind: "TypeRef",
    name: ctx.getText(),
    typeArguments: [],
    nullable: false,
    range: cx.range(ctx),
  };
}

/** A Groovy-style type: `String`, `String[]`. */
export function legacyType(
  ctx: LegacyTypeContext,
  cx: BuildContext,
): LegacyType {
  return {
    kind: "LegacyType",
    type: typeRef(ctx.type(), cx),
    dimensions: ctx.LBRACK().length,
    range: cx.range(ctx),
  };
}

export function typedName(
  ctx: NameTypePairContext,
  cx: BuildContext,
): TypedName {
  const type = ctx.type();
  const name = identifier(ctx.identifier(), cx);
  const range = cx.range(ctx);
  checkVariableName(name.name, range, cx);
  return {
    kind: "TypedName",
    name,
    type: type ? typeRef(type, cx) : null,
    range,
  };
}

export function parameter(
  ctx: FormalParameterContext,
  cx: BuildContext,
): FormalParameter {
  const legacy = ctx.legacyType();
  // the config grammar's `formalParameter` has no `name: Type` form
  const type = has<FormalParameterContext>(ctx, "type") ? ctx.type() : null;
  const defaultValue = ctx.expression();
  // Fields are created in source order: `def String name: Type = value`.
  const node = {
    kind: "Parameter" as const,
    def: ctx.DEF() !== null,
    legacyType: legacy ? legacyType(legacy, cx) : null,
    name: identifier(ctx.identifier(), cx),
    type: type ? typeRef(type, cx) : null,
    defaultValue: defaultValue ? expression(defaultValue, cx) : null,
    range: cx.range(ctx),
  };
  checkVariableName(node.name.name, node.range, cx);
  return node;
}
