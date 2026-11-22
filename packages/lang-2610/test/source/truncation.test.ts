import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { assertCut, cutSet } from "./cuts.ts";

const root = (p: string) =>
  fileURLToPath(new URL(`../../../../${p}`, import.meta.url));
const filesIn = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesIn(`${dir}/${e.name}`, ext)
      : ext.test(e.name)
        ? [`${dir}/${e.name}`]
        : [],
  );

const files = [
  ...filesIn(
    fileURLToPath(new URL("../ast/fixtures", import.meta.url)),
    /\.nf$/,
  ).map((path) => ({ path, config: false })),
  ...filesIn(root("tools/oracle/cases/config-constructs"), /\.config$/).map(
    (path) => ({
      path,
      config: true,
    }),
  ),
];

describe("F-104 IO-14 ADR-0004: truncating a file", () => {
  for (const { path, config } of files) {
    const file = path.replace(/^.*(ast\/fixtures|config-constructs)\//, "");
    it(`F-104 IO-14 ADR-0004: cutting ${file} anywhere keeps every earlier complete declaration modelled and loses no text`, () => {
      const set = cutSet(readFileSync(path, "utf8"), config, 8);
      for (const cut of set.cuts) assertCut(set, cut);
    });
  }
});
