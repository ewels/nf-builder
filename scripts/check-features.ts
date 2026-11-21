// features.json validation (F-003): shape, ids, spec references, dependencies, cycles, passes ordering.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADR_DIR } from "./check-adrs.ts";
import {
  isMain,
  type Problem,
  REPO_ROOT,
  reportProblems,
} from "./check-common.ts";

const FEATURES_FILE: string = join(REPO_ROOT, "docs/plan/features.json");
const SPEC_DIR: string = join(REPO_ROOT, "docs/spec");
const FEATURE_KEYS: readonly string[] = [
  "id",
  "milestone",
  "description",
  "spec",
  "depends_on",
  "steps",
  "passes",
  "notes",
];
type Feature = {
  id: string;
  milestone: string;
  description: string;
  spec: string[];
  depends_on: string[];
  steps: string[];
  passes: boolean;
  notes: string;
};

export function knownSpecIds(
  specDir: string = SPEC_DIR,
  adrDir: string = ADR_DIR,
): Set<string> {
  const ids = new Set<string>();
  if (existsSync(specDir))
    for (const name of readdirSync(specDir).filter((n) => n.endsWith(".md")))
      for (const m of readFileSync(join(specDir, name), "utf8").matchAll(
        /^\|\s*([A-Z]{2}-\d{2})\s*\|/gm,
      ))
        ids.add(m[1] ?? "");
  if (existsSync(adrDir))
    for (const name of readdirSync(adrDir)) {
      const m = /^(\d{4})-.*\.md$/.exec(name);
      if (m) ids.add(`ADR-${m[1]}`);
    }
  return ids;
}

/** Each cycle as an id path whose first and last elements are the same. */
export function findCycles(
  features: readonly Pick<Feature, "id" | "depends_on">[],
): string[][] {
  const edges = new Map(features.map((f) => [f.id, f.depends_on]));
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    const at = stack.indexOf(id);
    if (at !== -1) {
      const body = stack.slice(at);
      const min = body.indexOf([...body].sort()[0] ?? "");
      const rotated = [...body.slice(min), ...body.slice(0, min)];
      const key = rotated.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push([...rotated, rotated[0] ?? ""]);
      }
      return;
    }
    if (done.has(id) || !edges.has(id)) return;
    stack.push(id);
    for (const next of edges.get(id) ?? []) visit(next);
    stack.pop();
    done.add(id);
  };
  for (const f of features) visit(f.id);
  return cycles;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function validateFeatures(
  text: string,
  options: { file?: string; specIds?: ReadonlySet<string> } = {},
): Problem[] {
  const file = options.file ?? FEATURES_FILE;
  const problems: Problem[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return [
      {
        file,
        message: `features.json: not valid JSON: ${(error as Error).message}`,
      },
    ];
  }
  const top = data as Record<string, unknown> | null;
  if (typeof top !== "object" || top === null || !Array.isArray(top.features))
    return [
      {
        file,
        message:
          'features.json: the top level must be an object with a "features" array',
      },
    ];
  for (const key of Object.keys(top))
    if (key !== "features" && key !== "$comment")
      problems.push({
        file,
        message: `features.json: unknown top-level key "${key}"; allowed: $comment, features`,
      });
  if ("$comment" in top && typeof top.$comment !== "string")
    problems.push({
      file,
      message: 'features.json: "$comment" must be a string',
    });

  const items = top.features as unknown[];
  const idLines: number[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (/"id":\s*"/.test(l)) idLines.push(i + 1);
  });
  const lineOf = (index: number): number | undefined =>
    idLines.length === items.length ? idLines[index] : undefined;

  const firstSeen = new Map<string, number>();
  const byId = new Map<string, Record<string, unknown>>();
  const valid: Pick<Feature, "id" | "depends_on">[] = [];
  items.forEach((raw, index) => {
    const line = lineOf(index);
    const record = raw as Record<string, unknown>;
    const idText =
      typeof record?.id === "string" ? record.id : `features[${index}]`;
    const add = (message: string): void => {
      problems.push({ file, line, message: `${idText}: ${message}` });
    };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      add("must be an object");
      return;
    }
    for (const key of FEATURE_KEYS)
      if (!(key in record))
        add(
          `missing key "${key}"; every feature has: ${FEATURE_KEYS.join(", ")}`,
        );
    for (const key of Object.keys(record))
      if (!FEATURE_KEYS.includes(key))
        add(`unknown key "${key}"; allowed: ${FEATURE_KEYS.join(", ")}`);

    if ("id" in record) {
      if (typeof record.id !== "string" || !/^F-\d{3}$/.test(record.id))
        add('"id" must look like F-001');
      else if (firstSeen.has(record.id))
        add(
          `duplicate id; also used at line ${lineOf(firstSeen.get(record.id) ?? 0) ?? "?"} (this is line ${line ?? "?"}). Give each feature its own id.`,
        );
      else {
        firstSeen.set(record.id, index);
        byId.set(record.id, record);
      }
    }
    if (
      "milestone" in record &&
      (typeof record.milestone !== "string" || !/^M\d+$/.test(record.milestone))
    )
      add('"milestone" must look like M0');
    if (
      "description" in record &&
      (typeof record.description !== "string" ||
        record.description.trim() === "")
    )
      add('"description" must be a non-empty string');
    if ("spec" in record) {
      const spec = record.spec;
      if (!isStringArray(spec) || spec.length === 0)
        add('"spec" must be a non-empty array of IDs');
      else {
        if (new Set(spec).size !== spec.length) add('"spec" lists an ID twice');
        for (const id of spec) {
          if (!/^(ADR-\d{4}|[A-Z]{2}-\d{2})$/.test(id))
            add(`spec ID "${id}" must look like QA-01 or ADR-0003`);
          else if (options.specIds && !options.specIds.has(id))
            add(
              `spec ID ${id} is not defined in docs/spec/*.md or docs/adr/; fix the ID or add the requirement`,
            );
        }
      }
    }
    if ("depends_on" in record) {
      if (!isStringArray(record.depends_on))
        add('"depends_on" must be an array of feature ids');
      else if (new Set(record.depends_on).size !== record.depends_on.length)
        add('"depends_on" lists an id twice');
    }
    if ("steps" in record) {
      const steps = record.steps;
      if (
        !isStringArray(steps) ||
        steps.length === 0 ||
        steps.some((s) => s.trim() === "")
      )
        add('"steps" must be a non-empty array of non-empty strings');
    }
    if ("passes" in record && typeof record.passes !== "boolean")
      add('"passes" must be true or false');
    if ("notes" in record && typeof record.notes !== "string")
      add('"notes" must be a string');
    if (typeof record.id === "string" && isStringArray(record.depends_on))
      valid.push({ id: record.id, depends_on: record.depends_on });
  });

  const graph = valid.filter((f) => byId.has(f.id));
  const lineOfId = (id: string): number | undefined => {
    const i = firstSeen.get(id);
    return i === undefined ? undefined : lineOf(i);
  };
  for (const f of graph) {
    for (const dep of f.depends_on) {
      if (dep === f.id)
        problems.push({
          file,
          line: lineOfId(f.id),
          message: `${f.id}: depends on itself; remove it from depends_on`,
        });
      else if (!byId.has(dep))
        problems.push({
          file,
          line: lineOfId(f.id),
          message: `${f.id}: depends on ${dep}, which is not a feature id; fix or remove it`,
        });
    }
  }
  for (const cycle of findCycles(graph))
    if (cycle.length > 2)
      problems.push({
        file,
        line: lineOfId(cycle[0] ?? ""),
        message: `features.json: dependency cycle ${cycle.join(" → ")}; remove one of these depends_on entries`,
      });
  for (const f of valid) {
    if (byId.get(f.id)?.passes !== true) continue;
    for (const dep of f.depends_on)
      if (byId.has(dep) && byId.get(dep)?.passes !== true)
        problems.push({
          file,
          line: lineOfId(f.id),
          message: `${f.id} passes, but its dependency ${dep} does not. Set ${f.id} "passes" to false, or finish ${dep} first.`,
        });
  }
  return problems;
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (
      !["--file", "--spec-dir", "--adr-dir"].includes(flag ?? "") ||
      value === undefined
    ) {
      console.error(
        "usage: node scripts/check-features.ts [--file <path>] [--spec-dir <path>] [--adr-dir <path>]",
      );
      process.exit(2);
    }
    options.set(flag as string, value);
  }
  const file = options.get("--file") ?? FEATURES_FILE;
  if (!existsSync(file)) {
    console.error(`${file} not found`);
    process.exit(2);
  }
  const text = readFileSync(file, "utf8");
  const specIds = knownSpecIds(
    options.get("--spec-dir"),
    options.get("--adr-dir"),
  );
  const problems = validateFeatures(text, { file, specIds });
  if (reportProblems("features.json", problems)) {
    const features = (JSON.parse(text) as { features: Feature[] }).features;
    console.log(
      `features.json: ${features.length} features valid, ${features.filter((f) => f.passes).length} passing`,
    );
  } else process.exitCode = 1;
}
