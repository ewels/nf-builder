import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { WEB_DIST } from "../scripts/check-common.ts";

// A message of the parser's DescriptiveErrorStrategy: only the parser chunk holds it.
const PARSER_MARKER =
  "check for an unclosed brace, bracket, parenthesis, or string";

// A message of the printer (F-110): the printer shares the parser's lazy chunk.
const PRINTER_MARKER =
  "a script cannot mix top-level statements and declarations";

test("F-104 F-110 QA-01 ADR-0027: the parser loads in a lazy chunk, outside the initial JavaScript", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html);
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial) {
    const code = readFileSync(join(WEB_DIST, file), "utf8");
    expect(code, file).not.toContain(PARSER_MARKER);
    expect(code, file).not.toContain(PRINTER_MARKER);
  }
  const lazy = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `assets/${f}`)
    .filter((f) => !initial.includes(f));
  expect(
    lazy.some((f) =>
      readFileSync(join(WEB_DIST, f), "utf8").includes(PARSER_MARKER),
    ),
  ).toBe(true);
  expect(
    lazy.some((f) => {
      const code = readFileSync(join(WEB_DIST, f), "utf8");
      return code.includes(PARSER_MARKER) && code.includes(PRINTER_MARKER);
    }),
  ).toBe(true);
});
