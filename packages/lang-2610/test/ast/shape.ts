// The shape of a node for the re-parse comparison: ranges reduced to start and end offsets, shifted by `shift`; line and
// column numbers and comments ignored.

const RANGES = new Set(["range", "labelRange", "elseRange"]);
const IGNORED = new Set([
  "leadingComments",
  "trailingComments",
  "danglingComments",
  "comments",
  "shebang",
]);

export function shape(value: unknown, shift = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => shape(v, shift));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (IGNORED.has(key)) continue;
    if (RANGES.has(key)) {
      out[key] =
        v === null
          ? null
          : [
              (v as { start: number }).start + shift,
              (v as { end: number }).end + shift,
            ];
    } else {
      out[key] = shape(v, shift);
    }
  }
  return out;
}
