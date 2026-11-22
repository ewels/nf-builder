// Moves a chunk's AST, comments and problems from chunk coordinates to file coordinates (F-104). A chunk starts right
// after a "\n" (or at 0), so columns do not change: offsets move by the chunk's offset, lines by its first line - 1.
// The copy keeps shared objects shared (a comment is in `comments` and in a slot) with a memo map, so nothing is shifted
// twice. Range-shaped objects are found by their fields, so a future range field needs no change here.

interface By {
  readonly offset: number;
  readonly line: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const RANGE_FIELDS = ["start", "end", "line", "column", "endLine", "endColumn"];
const isRange = (o: Record<string, unknown>) =>
  RANGE_FIELDS.every((k) => typeof o[k] === "number");
const isProblem = (o: Record<string, unknown>) =>
  typeof o.source === "string" &&
  typeof o.message === "string" &&
  typeof o.line === "number" &&
  typeof o.endLine === "number";

export function shiftPositions<T>(value: T, by: By): T {
  const memo = new Map<unknown, unknown>();
  const copy = (v: unknown): unknown => {
    if (!isObject(v)) return v;
    const seen = memo.get(v);
    if (seen !== undefined) return seen;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      memo.set(v, out);
      for (const item of v) out.push(copy(item));
      return out;
    }
    const out: Record<string, unknown> = {};
    memo.set(v, out);
    if (isRange(v)) {
      Object.assign(out, v, {
        start: (v.start as number) + by.offset,
        end: (v.end as number) + by.offset,
        line: (v.line as number) + by.line,
        endLine: (v.endLine as number) + by.line,
      });
    } else if (isProblem(v)) {
      Object.assign(out, v, {
        line: (v.line as number) + by.line,
        endLine: (v.endLine as number) + by.line,
      });
    } else for (const [k, item] of Object.entries(v)) out[k] = copy(item);
    return out;
  };
  return copy(value) as T;
}
