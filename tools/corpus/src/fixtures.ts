import type { ParseResult } from "./manifest.ts";
import { isRecord, loadYaml, parseYaml, REPO_ROOT } from "./manifest.ts";

export const FIXTURES_DIR = `${REPO_ROOT}tools/corpus/fixtures`;
const FIXTURES_FILE = `${FIXTURES_DIR}/fixtures.yaml`;
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
): FixtureExpectation {
  if (!isRecord(value)) {
    problems.push(`${where}: "expect" must be a mapping`);
    return { wholeFile: true };
  }
  const whole = value.wholeFile ?? false;
  if (typeof whole !== "boolean") {
    problems.push(`${where}: "expect.wholeFile" must be true or false`);
    return { wholeFile: true };
  }
  const allowed = whole ? ["wholeFile"] : ["wholeFile", "unparsed", "modelled"];
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      problems.push(
        `${where}: unknown key "expect.${key}"; allowed: ${allowed.join(", ")}`,
      );
  if (whole) return { wholeFile: true };
  if (!("unparsed" in value && "modelled" in value)) {
    problems.push(
      `${where}: "expect" needs wholeFile: true, or both unparsed and modelled`,
    );
    return { wholeFile: true };
  }
  return {
    wholeFile: false,
    unparsed: names(where, "unparsed", value.unparsed, problems),
    modelled: names(where, "modelled", value.modelled, problems),
  };
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
    fixtures.push({
      ...item,
      expect: expectation(where, item.expect, problems),
    } as Fixture);
  });
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, value: { fixtures } };
}

export const loadFixtures = (file: string = FIXTURES_FILE): FixtureManifest =>
  loadYaml(file, parseFixtures);
