// Mirrors packages/lang-2610/test/printer/structure.ts (F-110): what a reprint must keep. Keep the two in step.
// The structure of an AST node for the round-trip tests: what the printer must keep. It drops ranges, comment slots and
// the flags the printer derives (`parens`, `braced`, `trailingComma`, an empty closure parameter list).
const DROPPED = new Set([
  "range",
  "labelRange",
  "elseRange",
  "leadingComments",
  "trailingComments",
  "danglingComments",
  "comments",
  "shebang",
  "parens",
  "braced",
  "trailingComma",
]);

export function structure(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(structure);
  if (typeof node !== "object" || node === null) return node;
  let record = node as Record<string, unknown>;
  // the formatter prints a last closure argument as a trailing closure (formatter.ts ~L644): `f({ ... })` is `f { ... }`
  const args = record.args;
  if (
    (record.kind === "MethodCall" || record.kind === "Call") &&
    Array.isArray(args) &&
    Array.isArray(record.closures) &&
    record.closures.length === 0 &&
    (args.at(-1) as { kind?: string } | undefined)?.kind === "Closure"
  )
    record = { ...record, args: args.slice(0, -1), closures: [args.at(-1)] };
  // and one `catch` per type of a multi-catch (formatter.ts, `catchClause`, ~L467)
  if (record.kind === "TryCatch" && Array.isArray(record.catches))
    record = {
      ...record,
      catches: (record.catches as { types?: unknown[] }[]).flatMap((c) =>
        Array.isArray(c.types) && c.types.length > 1
          ? c.types.map((t) => ({ ...c, types: [t] }))
          : [c],
      ),
    };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (DROPPED.has(key)) continue;
    // the formatter writes every catch clause in the typed form, `catch (e: T)` (formatter.ts, `tryCatch`)
    if (key === "legacy" && record.kind === "Catch") continue;
    if (
      key === "params" &&
      record.kind === "Closure" &&
      Array.isArray(value) &&
      value.length === 0
    ) {
      out[key] = null;
      continue;
    }
    out[key] = structure(value);
    // the formatter braces an `if` branch and omits an empty `else` (formatter.ts, `ifElse`, ~L300 and ~L432): `if (x) a`
    // is `if (x) { a }`, `if (x) ;` is `if (x) { }` and `else ;` is no `else`
    if (record.kind === "If" && (key === "consequent" || key === "alternate")) {
      const branch = out[key] as { kind?: string } | null;
      if (branch?.kind === "EmptyStatement")
        out[key] =
          key === "consequent" ? { kind: "Block", statements: [] } : null;
      else if (
        branch !== null &&
        branch?.kind !== "Block" &&
        !(key === "alternate" && branch?.kind === "If")
      )
        out[key] = { kind: "Block", statements: [branch] };
    }
    // the label of `main:` is derived: the printer writes it only when another section follows
    if (key === "main" && record.kind === "Workflow" && out[key] !== null)
      out[key] = { ...(out[key] as object), label: null };
    // a publish target drops its type
    if (
      key === "publishers" &&
      record.kind === "Workflow" &&
      out[key] !== null
    ) {
      const publishers = out[key] as { items: { type?: unknown }[] };
      out[key] = {
        ...publishers,
        items: publishers.items.map((i) => ({ ...i, type: null })),
      };
    }
  }
  return out;
}
