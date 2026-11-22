import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where a module release's bundle goes: registry/modules/<name>/<version>.json (the name keeps its "/"). */
export const moduleBundlePath = (name: string, version: string): string =>
  `registry/modules/${name}/${version}.json`;

export const pluginFilePath = (id: string, version: string): string =>
  `registry/plugins/${id}/${version}.json`;

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
