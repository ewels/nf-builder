import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { WEB_DIST } from "../scripts/check-common.ts";
import { E2E_BASE_PATH } from "./urls.ts";

// Strings that survive minification: the elk-api constructor's error, and the ELK Graph namespace the worker registers.
const ELK_MARKERS = [
  "Cannot construct an ELK without both",
  "http://www.eclipse.org/elk/ElkGraph",
];

test("F-207 QA-01 ADR-0003: ELK is only in a worker asset, not in the initial JavaScript", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html, E2E_BASE_PATH);
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial) {
    const text = readFileSync(join(WEB_DIST, file), "utf8");
    for (const marker of ELK_MARKERS)
      expect(text.includes(marker), `${file} holds ELK (${marker})`).toBe(
        false,
      );
  }
  // ELK's worker is one emitted asset, never a chunk of the Vite graph that the page loads at start
  const holders = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) =>
      readFileSync(join(WEB_DIST, "assets", f), "utf8").includes(
        ELK_MARKERS[1] as string,
      ),
    );
  expect(holders.length).toBeLessThanOrEqual(1);
  for (const f of holders) expect(initial).not.toContain(`assets/${f}`);
});
