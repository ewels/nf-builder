import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const MANIFEST_FILE = `${REPO_ROOT}tools/corpus/corpus.yaml`;
export const DEFAULT_CACHE_DIR = `${REPO_ROOT}.cache/corpus`;

export type Pipeline = { id: string; repo: string; ref: string; sha: string };
export type Manifest = { pipelines: Pipeline[] };
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; problems: string[] };

const KEYS = ["id", "repo", "ref", "sha"] as const;

export function parseYaml(text: string): ParseResult<unknown> {
  const doc = parseDocument(text);
  if (doc.errors.length > 0)
    return { ok: false, problems: doc.errors.map((e) => e.message) };
  return { ok: true, value: doc.toJS() };
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function stringProblem(
  where: string,
  key: "ref" | "sha",
  value: unknown,
): string | undefined {
  if (typeof value === "number")
    return `${where}: "${key}" must be a string; quote it, for example ${key}: "${value}"`;
  if (typeof value !== "string" || value === "")
    return `${where}: "${key}" must be a non-empty string`;
  return undefined;
}

export function parseManifest(text: string): ParseResult<Manifest> {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const top = parsed.value;
  if (!isRecord(top) || !("pipelines" in top))
    return {
      ok: false,
      problems: ['the top level must be a mapping with a "pipelines" list'],
    };
  const problems: string[] = [];
  for (const key of Object.keys(top))
    if (key !== "pipelines")
      problems.push(`unknown top-level key "${key}"; allowed: pipelines`);
  const list = top.pipelines;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('"pipelines" must be a non-empty list');
    return { ok: false, problems };
  }
  const seen = new Set<string>();
  list.forEach((item: unknown, i) => {
    const id = isRecord(item) && typeof item.id === "string" ? item.id : "?";
    const where = `pipelines[${i}] (${id})`;
    if (!isRecord(item)) {
      problems.push(`${where}: must be a mapping with id, repo, ref, sha`);
      return;
    }
    for (const key of KEYS)
      if (!(key in item))
        problems.push(
          `${where}: missing "${key}"; every pipeline has id, repo, ref, sha`,
        );
    for (const key of Object.keys(item))
      if (!(KEYS as readonly string[]).includes(key))
        problems.push(
          `${where}: unknown key "${key}"; allowed: id, repo, ref, sha`,
        );
    if ("id" in item) {
      if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item.id))
        problems.push(
          `${where}: "id" must be lowercase letters, digits and hyphens`,
        );
      else if (seen.has(item.id))
        problems.push(
          `${where}: duplicate id "${item.id}"; each pipeline needs its own cache directory`,
        );
      else seen.add(item.id);
    }
    if ("repo" in item) {
      if (
        typeof item.repo !== "string" ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repo)
      )
        problems.push(
          `${where}: "repo" must look like owner/name, got "${String(item.repo)}"`,
        );
    }
    if ("ref" in item) {
      const p = stringProblem(where, "ref", item.ref);
      if (p) problems.push(p);
    }
    if ("sha" in item) {
      const p = stringProblem(where, "sha", item.sha);
      if (p) problems.push(p);
      else if (!/^[0-9a-f]{40}$/.test(item.sha as string))
        problems.push(
          `${where}: "sha" must be a full 40-character lowercase commit SHA, got "${String(item.sha)}"`,
        );
    }
  });
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, value: { pipelines: list as Pipeline[] } };
}

/** Reads and parses a YAML file; throws an Error with one "<file>: <problem>" line per problem. */
export function loadYaml<T>(
  file: string,
  parse: (text: string) => ParseResult<T>,
): T {
  const result = parse(readFileSync(file, "utf8"));
  if (!result.ok)
    throw new Error(result.problems.map((p) => `${file}: ${p}`).join("\n"));
  return result.value;
}

export const loadManifest = (file: string = MANIFEST_FILE): Manifest =>
  loadYaml(file, parseManifest);
