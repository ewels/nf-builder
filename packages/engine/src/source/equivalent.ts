import type { SourceFile } from "@nf-builder/lang-core";

export type Equivalence =
  | { readonly equivalent: true }
  | { readonly equivalent: false; readonly reason: string };

/** Line endings to "\n", trailing whitespace stripped from every line and from the end of the text. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\s+$/, "");
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const RANGE_FIELDS = ["start", "end", "line", "column", "endLine", "endColumn"];
const isRange = (v: unknown) =>
  isObject(v) && RANGE_FIELDS.every((k) => typeof v[k] === "number");
/** Comment slots, the comment map and the shebang are compared as one ordered list instead. */
const IGNORED = new Set([
  "leadingComments",
  "trailingComments",
  "danglingComments",
  "comments",
  "shebang",
]);

interface Path {
  readonly parent: Path | null;
  readonly key: string;
}
const render = (path: Path | null): string => {
  const parts: string[] = [];
  for (let p = path; p; p = p.parent) parts.push(p.key);
  return parts.reverse().join("").replace(/^\./, "") || "ast";
};

const newlines = (s: string) => s.replace(/\r\n?/g, "\n");

/** The first difference between two ASTs ignoring positions and comment slots; null when there is none. Iterative. */
function diffAst(a: unknown, b: unknown): string | null {
  const stack: [unknown, unknown, Path | null][] = [[a, b, null]];
  while (stack.length > 0) {
    const [x, y, path] = stack.pop() as [unknown, unknown, Path | null];
    if (typeof x === "string" && typeof y === "string") {
      if (newlines(x) !== newlines(y)) return `${render(path)} differs`;
      continue;
    }
    if (!isObject(x) || !isObject(y)) {
      if (!Object.is(x, y)) return `${render(path)} differs`;
      continue;
    }
    if (Array.isArray(x) !== Array.isArray(y)) return `${render(path)} differs`;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length)
        return `${render(path)} has ${x.length} items, not ${y.length}`;
      for (let i = x.length - 1; i >= 0; i--)
        stack.push([x[i], y[i], { parent: path, key: `[${i}]` }]);
      continue;
    }
    if (x.kind === "Unparsed" || y.kind === "Unparsed") {
      if (x.kind !== y.kind)
        return `${render(path)} is ${String(x.kind)}, not ${String(y.kind)}`;
      if (normaliseText(String(x.text)) !== normaliseText(String(y.text)))
        return `${render(path)} (unparsed text) differs`;
      const hx = JSON.stringify(x.head);
      if (hx !== JSON.stringify(y.head)) return `${render(path)}.head differs`;
      continue;
    }
    const keys = (o: Record<string, unknown>) =>
      Object.keys(o).filter(
        (k) => !IGNORED.has(k) && o[k] !== undefined && !isRange(o[k]),
      );
    const kx = keys(x);
    const ky = new Set(keys(y));
    for (const k of kx)
      if (!ky.has(k))
        return `${render({ parent: path, key: `.${k}` })} is missing on one side`;
    if (ky.size !== kx.length) {
      const missing = [...ky].find((k) => !kx.includes(k)) as string;
      return `${render({ parent: path, key: `.${missing}` })} is missing on one side`;
    }
    for (let i = kx.length - 1; i >= 0; i--) {
      const k = kx[i] as string;
      stack.push([x[k], y[k], { parent: path, key: `.${k}` }]);
    }
  }
  return null;
}

function commentList(file: SourceFile): [string, string][] {
  const ast = file.ast;
  if (ast === null) return [];
  const shebang = ast.kind === "Script" ? ast.shebang : null;
  const all = shebang ? [shebang, ...ast.comments] : ast.comments;
  return all.map((c) => [c.kind, normaliseText(c.text)]);
}

const family = (file: SourceFile) =>
  file.status === "modelled" || file.status === "partial"
    ? "modelled"
    : file.status;

/**
 * The spec glossary's "equivalent": the same AST ignoring source positions and whitespace, and the same comments in
 * the same order. Unparsed text and verbatim or plain files compare after `normaliseText`; strings in the AST compare
 * with line endings normalised (Groovy drops CR from multi-line strings).
 */
export function equivalent(a: SourceFile, b: SourceFile): Equivalence {
  if (a.language !== b.language)
    return {
      equivalent: false,
      reason: `language ${a.language} differs from ${b.language}`,
    };
  if (family(a) !== family(b))
    return {
      equivalent: false,
      reason: `status ${a.status} differs from ${b.status}`,
    };
  if (a.ast === null || b.ast === null)
    return normaliseText(a.text) === normaliseText(b.text)
      ? { equivalent: true }
      : { equivalent: false, reason: "text differs" };
  const diff = diffAst(a.ast, b.ast);
  if (diff !== null) return { equivalent: false, reason: diff };
  const ca = commentList(a);
  const cb = commentList(b);
  if (ca.length !== cb.length)
    return {
      equivalent: false,
      reason: `comment count ${ca.length} differs from ${cb.length}`,
    };
  for (let i = 0; i < ca.length; i++)
    if (ca[i]?.[0] !== cb[i]?.[0] || ca[i]?.[1] !== cb[i]?.[1])
      return { equivalent: false, reason: `comment ${i + 1} differs` };
  return { equivalent: true };
}
