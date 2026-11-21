import { readFileSync } from "node:fs";
import type { ParseResult } from "./manifest.ts";
import { parseYaml, REPO_ROOT } from "./manifest.ts";

export const FIXTURES_DIR = `${REPO_ROOT}tools/corpus/fixtures`;
export const FIXTURES_FILE = `${FIXTURES_DIR}/fixtures.yaml`;
export const FIXTURE_HEADER = "// Malformed on purpose: ";

export type LintOutcome = "error" | "ok";
export type FixtureExpectation =
  | { wholeFile: true }
  | { wholeFile: false; unparsed: string[]; modelled: string[] };
export type Fixture = {
  file: string;
  breaks: string;
  lint: LintOutcome;
  expect: FixtureExpectation;
};
export type FixtureManifest = { fixtures: Fixture[] };

const KEYS = ["file", "breaks", "lint", "expect"] as const;
const DECLARATION =
  /^(?:(?:process|featureFlag|assign|block) \S+|workflow(?: \S+)?)$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function names(
  where: string,
  key: "unparsed" | "modelled",
  value: unknown,
  problems: string[],
): string[] {
  if (!Array.isArray(value)) {
    problems.push(
      `${where}: "expect.${key}" must be a list of declaration names`,
    );
    return [];
  }
  for (const name of value)
    if (typeof name !== "string" || !DECLARATION.test(name))
      problems.push(
        `${where}: "expect.${key}" has an invalid declaration name "${String(name)}"; use process NAME, workflow [NAME], featureFlag NAME, assign PATH or block NAME`,
      );
  return value.map(String);
}

function expectation(
  where: string,
  value: unknown,
  problems: string[],
): FixtureExpectation | undefined {
  if (!isRecord(value)) {
    problems.push(`${where}: "expect" must be a mapping`);
    return undefined;
  }
  const whole = value.wholeFile ?? false;
  if (typeof whole !== "boolean") {
    problems.push(`${where}: "expect.wholeFile" must be true or false`);
    return undefined;
  }
  const allowed = whole ? ["wholeFile"] : ["wholeFile", "unparsed", "modelled"];
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      problems.push(
        `${where}: unknown key "expect.${key}"; allowed: ${allowed.join(", ")}`,
      );
  if (whole) return { wholeFile: true };
  for (const key of ["unparsed", "modelled"])
    if (!(key in value))
      problems.push(
        `${where}: "expect" needs wholeFile: true, or both unparsed and modelled`,
      );
  if (!("unparsed" in value && "modelled" in value)) return undefined;
  const before = problems.length;
  const unparsed = names(where, "unparsed", value.unparsed, problems);
  const modelled = names(where, "modelled", value.modelled, problems);
  return problems.length === before
    ? { wholeFile: false, unparsed, modelled }
    : undefined;
}

export function parseFixtures(text: string): ParseResult<FixtureManifest> {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const top = parsed.value;
  if (!isRecord(top) || !("fixtures" in top))
    return {
      ok: false,
      problems: ['the top level must be a mapping with a "fixtures" list'],
    };
  const problems: string[] = [];
  for (const key of Object.keys(top))
    if (key !== "fixtures")
      problems.push(`unknown top-level key "${key}"; allowed: fixtures`);
  const list = top.fixtures;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('"fixtures" must be a non-empty list');
    return { ok: false, problems };
  }
  const fixtures: Fixture[] = [];
  const seen = new Set<string>();
  list.forEach((item: unknown, i) => {
    const file =
      isRecord(item) && typeof item.file === "string" ? item.file : "?";
    const where = `fixtures[${i}] (${file})`;
    if (!isRecord(item)) {
      problems.push(
        `${where}: must be a mapping with file, breaks, lint, expect`,
      );
      return;
    }
    const before = problems.length;
    for (const key of KEYS)
      if (!(key in item))
        problems.push(
          `${where}: missing "${key}"; every fixture has file, breaks, lint, expect`,
        );
    for (const key of Object.keys(item))
      if (!(KEYS as readonly string[]).includes(key))
        problems.push(
          `${where}: unknown key "${key}"; allowed: ${KEYS.join(", ")}`,
        );
    if ("file" in item) {
      if (
        typeof item.file !== "string" ||
        !/^[a-z0-9-]+\.(nf|config)$/.test(item.file)
      )
        problems.push(
          `${where}: "file" must be lowercase letters, digits and hyphens with a .nf or .config extension`,
        );
      else if (seen.has(item.file))
        problems.push(`${where}: duplicate file "${item.file}"`);
      else seen.add(item.file);
    }
    if (
      "breaks" in item &&
      (typeof item.breaks !== "string" || item.breaks === "")
    )
      problems.push(`${where}: "breaks" must be a non-empty string`);
    if ("lint" in item && item.lint !== "error" && item.lint !== "ok")
      problems.push(
        `${where}: "lint" must be error or ok, got "${String(item.lint)}"`,
      );
    const expect =
      "expect" in item ? expectation(where, item.expect, problems) : undefined;
    if (problems.length === before && expect)
      fixtures.push({
        file: item.file as string,
        breaks: item.breaks as string,
        lint: item.lint as LintOutcome,
        expect,
      });
  });
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, value: { fixtures } };
}

/** Reads and parses the file (default FIXTURES_FILE); throws an Error whose message is one "<file>: <problem>" line per problem. */
export function loadFixtures(file: string = FIXTURES_FILE): FixtureManifest {
  const result = parseFixtures(readFileSync(file, "utf8"));
  if (!result.ok)
    throw new Error(result.problems.map((p) => `${file}: ${p}`).join("\n"));
  return result.value;
}
