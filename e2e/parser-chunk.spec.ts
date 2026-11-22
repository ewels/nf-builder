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

test("F-104 QA-01 ADR-0027: the parser loads in a lazy chunk, outside the initial JavaScript", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html);
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(
      PARSER_MARKER,
    );
  const lazy = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `assets/${f}`)
    .filter((f) => !initial.includes(f));
  expect(
    lazy.some((f) =>
      readFileSync(join(WEB_DIST, f), "utf8").includes(PARSER_MARKER),
    ),
  ).toBe(true);
});
