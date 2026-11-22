// The two guards on every command result (AR-24, LA-13, F-111).
import type {
  FileText,
  ParseProblem,
  ScriptAst,
  SourceFile,
  SourceParser,
} from "@nf-builder/lang-core";
import { createSourceFile } from "../source/source-file";
import { EditRefusal } from "./refusal";

const MIXED = "mixed-definitions";

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

/** The processes and workflows of a script by style, and the `Unparsed` problems tagged `mixed-definitions`. */
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
          ? (item.name?.name ?? "workflow")
          : item.name.name;
      (item.typed ? typed : legacy).push(name);
    } else if (item.kind === "Unparsed")
      tagged.push(...item.problems.filter((p) => p.code === MIXED));
  }
  return { typed, legacy, tagged };
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
  const tagged = [
    ...styles.tagged,
    ...file.problems.filter((p) => p.code === MIXED),
  ];
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
    const list = (names: string[]) =>
      names.length > 0 ? names.join(", ") : "none";
    const details = now.tagged.map((p) => p.message);
    throw new EditRefusal(
      "mixed-definitions",
      `This edit would put typed and legacy process or workflow definitions in \`${file.path}\` (typed: ${list(now.typed)}; legacy: ${list(now.legacy)}). A script can't mix them: keep legacy definitions in their own file, or migrate them to typed.${details.length > 0 ? ` ${details.join(" ")}` : ""}`,
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
