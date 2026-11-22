import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A path from the repository root. */
export const repo = (p: string) =>
  fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

/** Files under `dir`, at any depth, whose names match `ext`. */
export const filesIn = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesIn(`${dir}/${e.name}`, ext)
      : ext.test(e.name)
        ? [`${dir}/${e.name}`]
        : [],
  );

/** F-102's script fixtures. */
export const scriptFixtures = () =>
  filesIn(repo("packages/lang-2610/test/ast/fixtures"), /\.nf$/);
/** The config construct oracle cases. */
export const configFixtures = () =>
  filesIn(repo("tools/oracle/cases/config-constructs"), /\.config$/);

/** A malformed fixture from tools/corpus/fixtures. */
export const malformed = (name: string) =>
  readFileSync(repo(`tools/corpus/fixtures/${name}`), "utf8");
