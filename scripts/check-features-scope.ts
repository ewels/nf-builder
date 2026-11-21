// features.json scope guard (F-004, ADR 0012): without the scope-change label a pull request may only set
// "passes" and append to "notes". Imports only `node:` built-ins and ./check-common.ts, so its CI job needs no
// `pnpm install`. Local use:
//   git show origin/main:docs/plan/features.json > /tmp/base.json && node scripts/check-features-scope.ts --base /tmp/base.json
// Labels come from the PR_LABELS environment variable (a JSON array of names); unset means none.
import { readFileSync } from "node:fs";
import { isMain, type Problem, reportProblems } from "./check-common.ts";
import { FEATURES_FILE } from "./check-features.ts";

const SCOPE_CHANGE_LABEL = "scope-change";

type FeatureChange =
  | { kind: "passes"; id: string; from: unknown; to: unknown }
  | { kind: "notes-appended"; id: string }
  | { kind: "notes-rewritten"; id: string }
  | { kind: "field"; id: string; field: string; from: unknown; to: unknown }
  | { kind: "added"; id: string }
  | { kind: "removed"; id: string }
  | { kind: "reordered"; first: string; before: string }
  | { kind: "top-level"; key: string };

type ScopeVerdict = {
  ok: boolean;
  labelled: boolean;
  changes: FeatureChange[];
  problems: Problem[];
};

type Item = Record<string, unknown> & { id: string };
type Parsed = { top: Record<string, unknown>; features: Item[] };

export function isScopeChange(change: FeatureChange): boolean {
  return change.kind !== "passes" && change.kind !== "notes-appended";
}

const show = (value: unknown): string => {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

function describeChange(change: FeatureChange): string {
  switch (change.kind) {
    case "passes":
      return `${change.id}: "passes" ${show(change.from)} → ${show(change.to)}`;
    case "notes-appended":
      return `${change.id}: "notes" appended to`;
    case "notes-rewritten":
      return `${change.id}: "notes" was edited or shortened, not appended to (the new notes must start with the old notes)`;
    case "field":
      return `${change.id}: "${change.field}" changed from ${show(change.from)} to ${show(change.to)}`;
    case "added":
      return `${change.id}: feature added`;
    case "removed":
      return `${change.id}: feature removed`;
    case "reordered":
      return `features reordered: ${change.first} now comes before ${change.before} (file order is priority)`;
    case "top-level":
      return `top-level "${change.key}" changed`;
  }
}

/** Throws a short reason when the text isn't a comparable features file. */
function parse(text: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON (${(error as Error).message})`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new Error("the top level is not an object");
  const { features, ...top } = data as Record<string, unknown>;
  if (!Array.isArray(features)) throw new Error('"features" is not an array');
  const seen = new Set<string>();
  for (const item of features) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error("a feature is not an object");
    const id = (item as Record<string, unknown>).id;
    if (typeof id !== "string") throw new Error("a feature has no string id");
    if (seen.has(id)) throw new Error(`duplicate id ${id}`);
    seen.add(id);
  }
  return { top, features: features as Item[] };
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function diff(base: Parsed, head: Parsed): FeatureChange[] {
  const changes: FeatureChange[] = [];
  for (const key of new Set([
    ...Object.keys(base.top),
    ...Object.keys(head.top),
  ]))
    if (!same(base.top[key], head.top[key]))
      changes.push({ kind: "top-level", key });
  const baseById = new Map(base.features.map((f) => [f.id, f]));
  const headIds = new Set(head.features.map((f) => f.id));
  for (const h of head.features) {
    const b = baseById.get(h.id);
    if (!b) {
      changes.push({ kind: "added", id: h.id });
      continue;
    }
    for (const key of new Set([...Object.keys(b), ...Object.keys(h)])) {
      if (same(b[key], h[key])) continue;
      if (key === "passes")
        changes.push({ kind: "passes", id: h.id, from: b[key], to: h[key] });
      else if (key === "notes")
        changes.push({
          kind:
            typeof b.notes === "string" &&
            typeof h.notes === "string" &&
            h.notes.startsWith(b.notes)
              ? "notes-appended"
              : "notes-rewritten",
          id: h.id,
        });
      else
        changes.push({
          kind: "field",
          id: h.id,
          field: key,
          from: b[key],
          to: h[key],
        });
    }
  }
  for (const b of base.features)
    if (!headIds.has(b.id)) changes.push({ kind: "removed", id: b.id });
  const baseCommon = base.features
    .map((f) => f.id)
    .filter((id) => headIds.has(id));
  const headCommon = head.features
    .map((f) => f.id)
    .filter((id) => baseById.has(id));
  const at = headCommon.findIndex((id, i) => id !== baseCommon[i]);
  if (at >= 0)
    changes.push({
      kind: "reordered",
      first: headCommon[at] ?? "",
      before: baseCommon[at] ?? "",
    });
  return changes;
}

function lineOf(change: FeatureChange, headText: string): number | undefined {
  const id =
    change.kind === "reordered"
      ? change.first
      : change.kind === "field" ||
          change.kind === "notes-rewritten" ||
          change.kind === "added"
        ? change.id
        : undefined;
  if (id === undefined) return undefined;
  const re = new RegExp(
    `"id":\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
  );
  const index = headText.split("\n").findIndex((l) => re.test(l));
  return index < 0 ? undefined : index + 1;
}

export function checkFeatureScope(input: {
  baseText: string;
  headText: string;
  labels: readonly string[];
  file?: string;
}): ScopeVerdict {
  const file = input.file ?? FEATURES_FILE;
  const labelled = input.labels.includes(SCOPE_CHANGE_LABEL);
  let base: Parsed;
  try {
    base = parse(input.baseText);
  } catch (error) {
    throw new Error(
      `The base features.json can't be read: ${(error as Error).message}`,
    );
  }
  let head: Parsed;
  try {
    head = parse(input.headText);
  } catch (error) {
    return {
      ok: false,
      labelled,
      changes: [],
      problems: [
        {
          file,
          message: `features.json can't be compared with the base branch: ${(error as Error).message}. Fix it first (pnpm check:features).`,
        },
      ],
    };
  }
  const changes = diff(base, head);
  const scope = changes.filter(isScopeChange);
  const ok = scope.length === 0 || labelled;
  const problems: Problem[] = ok
    ? []
    : scope.map((change) => ({
        file,
        line: lineOf(change, input.headText),
        message: `${describeChange(change)}; add the scope-change label (and record the decision per AGENTS.md) (ADR 0012)`,
      }));
  return { ok, labelled, changes, problems };
}

export function parseLabels(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    data = undefined;
  }
  if (!Array.isArray(data) || !data.every((l) => typeof l === "string"))
    throw new Error(
      `PR_LABELS must be a JSON array of label names, such as ["scope-change"]; got: ${value.slice(0, 80)}`,
    );
  return data as string[];
}

function main(argv: string[]): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const basePath = arg("--base");
  if (basePath === undefined) {
    console.error(
      "usage: node scripts/check-features-scope.ts --base <file> [--head <file>] (labels from PR_LABELS)",
    );
    return 2;
  }
  const headPath = arg("--head") ?? FEATURES_FILE;
  let verdict: ScopeVerdict;
  try {
    verdict = checkFeatureScope({
      baseText: readFileSync(basePath, "utf8"),
      headText: readFileSync(headPath, "utf8"),
      labels: parseLabels(process.env.PR_LABELS),
      file: headPath,
    });
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (!reportProblems("features.json scope", verdict.problems)) {
    console.log(
      'Only "passes" changes and text appended to "notes" are allowed without a label (ADR 0012). If these changes are intended, add the scope-change label to the PR and record the decision (an ADR or an open-questions.md answer, and a Decisions line in progress.md); otherwise undo them.',
    );
    return 1;
  }
  const scope = verdict.changes.filter(isScopeChange);
  const allowed = verdict.changes.filter((c) => !isScopeChange(c));
  console.log(
    verdict.changes.length === 0
      ? "features.json: no changes"
      : scope.length > 0
        ? `features.json: ${scope.length} scope change(s) allowed by the scope-change label`
        : `features.json: ${allowed.length} allowed change(s)`,
  );
  for (const c of [...scope, ...allowed]) console.log(`  ${describeChange(c)}`);
  return 0;
}

if (isMain(import.meta)) process.exitCode = main(process.argv.slice(2));
