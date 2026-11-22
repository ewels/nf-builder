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
  const record = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (DROPPED.has(key)) continue;
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
