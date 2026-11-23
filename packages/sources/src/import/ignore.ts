import type { IgnoreProblem } from "./types.ts";

export const DEFAULT_IGNORE = `# Run output and caches
work/
results/
null/
.nextflow*
.nf-test*
.lineage/
# Test data
/data/
/testing/
/test-datasets/
# Version control and system files
.git/
node_modules/
__MACOSX/
.DS_Store
`;

interface IgnoreRule {
  readonly line: number;
  readonly folderOnly: boolean;
  readonly tokens: readonly Token[];
}

// `?` is one character but a slash; `*` any run but a slash; `**` any run; a `**` followed by a slash is zero or more folders.
type Token =
  | { readonly kind: "char"; readonly ch: string }
  | { readonly kind: "one" | "star" | "globstar" | "folders" };

export interface IgnoreList {
  readonly rules: readonly IgnoreRule[];
  readonly problems: readonly IgnoreProblem[];
}

function tokenise(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern.charAt(i);
    if (ch === "*") {
      let end = i;
      while (pattern.charAt(end + 1) === "*") end += 1;
      const run = end - i + 1;
      if (run === 1) tokens.push({ kind: "star" });
      else if (pattern.charAt(end + 1) === "/") {
        tokens.push({ kind: "folders" });
        end += 1;
      } else tokens.push({ kind: "globstar" });
      i = end;
    } else if (ch === "?") tokens.push({ kind: "one" });
    else tokens.push({ kind: "char", ch });
  }
  return tokens;
}

/**
 * Whether the tokens match the whole path. Instead of backtracking, it keeps the set of path offsets reachable after each
 * token, so the work is tokens times path length however many wildcards the pattern has.
 */
function matches(tokens: readonly Token[], path: string): boolean {
  const n = path.length;
  let reach = new Uint8Array(n + 1);
  reach[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(n + 1);
    let open = false;
    for (let q = 0; q <= n; q += 1) {
      switch (token.kind) {
        case "char":
          if (q > 0 && reach[q - 1] === 1 && path.charAt(q - 1) === token.ch)
            next[q] = 1;
          break;
        case "one":
          if (q > 0 && reach[q - 1] === 1 && path.charAt(q - 1) !== "/")
            next[q] = 1;
          break;
        case "star":
          if (reach[q] === 1) open = true;
          if (open) next[q] = 1;
          if (path.charAt(q) === "/") open = false;
          break;
        case "globstar":
          if (reach[q] === 1) open = true;
          if (open) next[q] = 1;
          break;
        case "folders":
          if (open && path.charAt(q - 1) === "/") next[q] = 1;
          if (reach[q] === 1) {
            open = true;
            next[q] = 1;
          }
          break;
      }
    }
    reach = next;
  }
  return reach[n] === 1;
}

function unsupported(text: string): string | null {
  if (text.startsWith("!")) return "Negated patterns (!) aren't supported.";
  if (text.includes("[")) return "Character classes ([ ]) aren't supported.";
  if (text.includes("\\")) return "Backslash escapes aren't supported.";
  return null;
}

export function parseIgnore(text: string): IgnoreList {
  const rules: IgnoreRule[] = [];
  const problems: IgnoreProblem[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const message = unsupported(trimmed);
    if (message !== null) {
      problems.push({ line, text: trimmed, message });
      return;
    }
    const folderOnly = trimmed.endsWith("/");
    const body = folderOnly ? trimmed.slice(0, -1) : trimmed;
    const anchored = body.includes("/");
    const pattern = body.startsWith("/") ? body.slice(1) : body;
    if (pattern === "") {
      problems.push({ line, text: trimmed, message: "The pattern is empty." });
      return;
    }
    const tokens = tokenise(pattern);
    if (!anchored) tokens.unshift({ kind: "folders" });
    rules.push({ line, folderOnly, tokens });
  });
  return { rules, problems };
}

/** A path is ignored when a rule matches it or any folder above it. */
export function isIgnored(list: IgnoreList, path: string): boolean {
  const segments = path.split("/");
  for (let n = 1; n <= segments.length; n += 1) {
    const prefix = segments.slice(0, n).join("/");
    const isFolder = n < segments.length;
    for (const rule of list.rules) {
      if (rule.folderOnly && !isFolder) continue;
      if (matches(rule.tokens, prefix)) return true;
    }
  }
  return false;
}
