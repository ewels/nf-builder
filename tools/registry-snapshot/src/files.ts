import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function check(kind: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value))
    throw new Error(`invalid ${kind} ${JSON.stringify(value)}`);
  return value;
}

/** Registry values become file paths, so each is checked first; an invalid one fails its item. */
export const checkModuleName = (name: string): string =>
  check("module name", name, NAME);
export const checkVersion = (version: string): string =>
  check("version", version, VERSION);
export const checkPluginId = (id: string): string =>
  check("plugin id", id, PLUGIN_ID);

/** Where a module release's bundle goes: registry/modules/<name>/<version>.json (the name keeps its "/"). */
export const moduleBundlePath = (name: string, version: string): string =>
  `registry/modules/${checkModuleName(name)}/${checkVersion(version)}.json`;

export const pluginFilePath = (id: string, version: string): string =>
  `registry/plugins/${checkPluginId(id)}/${checkVersion(version)}.json`;

/** Minified JSON, deterministic for the same value (keys in insertion order). */
export const serialise = (value: unknown): string => JSON.stringify(value);

/** Replaces `<dir>/registry` with the files (keys are snapshot paths such as "registry/index.json"). */
export function writeSnapshot(
  dir: string,
  files: ReadonlyMap<string, string>,
): void {
  rmSync(join(dir, "registry"), { recursive: true, force: true });
  for (const [path, text] of files) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
