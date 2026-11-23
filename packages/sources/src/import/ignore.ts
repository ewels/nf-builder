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

export interface IgnoreRule {
  readonly line: number;
  readonly pattern: string;
  readonly anchored: boolean;
  readonly folderOnly: boolean;
  readonly regex: RegExp;
}

export interface IgnoreList {
  readonly rules: readonly IgnoreRule[];
  readonly problems: readonly IgnoreProblem[];
}

function globBody(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern.charAt(i);
    if (ch === "*" && pattern.charAt(i + 1) === "*") {
      if (pattern.charAt(i + 2) === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return out;
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
    const regex = new RegExp(
      `^${anchored ? "" : "(?:.*/)?"}${globBody(pattern)}$`,
    );
    rules.push({ line, pattern: trimmed, anchored, folderOnly, regex });
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
      if (rule.regex.test(prefix)) return true;
    }
  }
  return false;
}
