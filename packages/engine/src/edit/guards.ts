// The two guards on every command result (AR-24, LA-13, F-111).
import {
  type FileText,
  MIXED_DEFINITIONS,
  type ParseProblem,
  type ScriptAst,
  type SourceFile,
  type SourceParser,
} from "@nf-builder/lang-core";
import { createSourceFile } from "../source/source-file";
import { EditRefusal } from "./refusal";

/** Every problem of a file: the whole-file ones and those on its `Unparsed` items. */
function problemsOf(file: SourceFile): ParseProblem[] {
  const out = [...file.problems];
  const ast = file.ast;
  if (ast?.kind === "Script")
    for (const item of ast.body)
      if (item.kind === "Unparsed") out.push(...item.problems);
  return out;
}

const keyOf = (p: ParseProblem) => `${p.source}:${p.message}`;

/** The multiset of problem keys (`source:message`, positions left out so a shifted problem is the same one), sorted. */
export function problemKeys(file: SourceFile): string[] {
  return problemsOf(file).map(keyOf).sort();
}

/** The name a definition goes by in a refusal message. */
const displayName = (name: string | null | undefined): string =>
  name ? name : "the entry workflow";

/** The style a `mixed-definitions` message says a definition is written in: nf-lang names the style it expected. */
function writtenStyle(message: string): "typed" | "legacy" | null {
  const found = /\bin (typed|legacy) (?:process|workflow)\b/.exec(message);
  if (!found) return null;
  return found[1] === "typed" ? "legacy" : "typed";
}

/**
 * The processes and workflows of a script by style, and the problems tagged `mixed-definitions` (once each). A
 * definition that became `Unparsed` for being in the wrong style is listed under the style its message implies.
 */
export function definitionStyles(ast: ScriptAst): {
  typed: string[];
  legacy: string[];
  tagged: ParseProblem[];
} {
  const typed: string[] = [];
  const legacy: string[] = [];
  const tagged: ParseProblem[] = [];
  for (const item of ast.body) {
    if (item.kind === "Process" || item.kind === "Workflow") {
      const name =
        item.kind === "Workflow"
          ? displayName(item.name?.name)
          : item.name.name;
      (item.typed ? typed : legacy).push(name);
    } else if (item.kind === "Unparsed") {
      const own = item.problems.filter((p) => p.code === MIXED_DEFINITIONS);
      tagged.push(...own);
      const head = item.head;
      const style = own.map((p) => writtenStyle(p.message)).find(Boolean);
      if (
        style &&
        (head?.keyword === "process" || head?.keyword === "workflow")
      )
        (style === "typed" ? typed : legacy).push(
          head.keyword === "workflow"
            ? displayName(head.name)
            : (head.name ?? "process"),
        );
    }
  }
  return { typed, legacy, tagged: uniqueProblems(tagged) };
}

/** `problems` without repeats of the same message at the same position. */
function uniqueProblems(problems: readonly ParseProblem[]): ParseProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.message}@${p.line}:${p.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mixedState(file: SourceFile | undefined): {
  mixed: boolean;
  typed: string[];
  legacy: string[];
  tagged: ParseProblem[];
} {
  if (file?.ast?.kind !== "Script")
    return { mixed: false, typed: [], legacy: [], tagged: [] };
  const styles = definitionStyles(file.ast);
  const tagged = uniqueProblems([
    ...styles.tagged,
    ...file.problems.filter((p) => p.code === MIXED_DEFINITIONS),
  ]);
  return {
    ...styles,
    tagged,
    mixed:
      (styles.typed.length > 0 && styles.legacy.length > 0) ||
      tagged.length > 0,
  };
}

/** Removes one occurrence per key of `old` from `now`. */
function newProblems(
  old: SourceFile | undefined,
  now: SourceFile,
): ParseProblem[] {
  const counts = new Map<string, number>();
  for (const p of old ? problemsOf(old) : []) {
    const k = keyOf(p);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return problemsOf(now).filter((p) => {
    const k = keyOf(p);
    const n = counts.get(k) ?? 0;
    if (n > 0) {
      counts.set(k, n - 1);
      return false;
    }
    return true;
  });
}

/**
 * Checks the new text of every changed file; throws `EditRefusal` for a script that would newly mix typed and legacy
 * definitions (LA-13), or a file with a problem it didn't have (AR-24). Problems a file already had don't count, so a
 * partly broken file stays editable (ADR 0004). Plain files and deletions pass.
 */
export function checkResult(
  before: (path: string) => SourceFile | undefined,
  after: readonly FileText[],
  parser: SourceParser,
): void {
  const parsed = after.flatMap((f) =>
    f.text === null ? [] : [createSourceFile(f.path, f.text, parser)],
  );
  for (const file of parsed) {
    if (file.language !== "nextflow") continue;
    const now = mixedState(file);
    if (!now.mixed || mixedState(before(file.path)).mixed) continue;
    const styles = [
      now.typed.length > 0 ? `typed: ${now.typed.join(", ")}` : null,
      now.legacy.length > 0 ? `legacy: ${now.legacy.join(", ")}` : null,
    ].filter((part) => part !== null);
    const named = styles.length > 0 ? ` (${styles.join("; ")})` : "";
    const details = now.tagged.map((p) => `${p.message} (line ${p.line}).`);
    throw new EditRefusal(
      "mixed-definitions",
      `This edit would put typed and legacy process or workflow definitions in \`${file.path}\`${named}. A script can't mix them: keep legacy definitions in their own file, or migrate them to typed.${details.length > 0 ? ` ${details.join(" ")}` : ""}`,
      file.path,
      now.tagged,
    );
  }
  for (const file of parsed) {
    if (file.language !== "nextflow" && file.language !== "config") continue;
    const added = newProblems(before(file.path), file);
    if (added.length === 0) continue;
    const first = added[0] as ParseProblem;
    throw new EditRefusal(
      "does-not-parse",
      `This edit would leave \`${file.path}\` with an error it didn't have: ${first.message} (line ${first.line}, column ${first.column}). Nothing was changed.`,
      file.path,
      added,
    );
  }
}
