import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { packFor, WEB_DIST } from "../scripts/check-common.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { watchForCspViolations } from "./csp.ts";
import { E2E_BASE_PATH } from "./urls.ts";

const CATEGORIES = [
  "Processes",
  "Workflows",
  "Channel factories",
  "Operators",
  "Params & outputs",
  "Types, functions & includes",
  "Plugins & config",
];
const DEFAULT_OPEN = new Set(["Processes", "Workflows", "Operators"]);

const palette = (page: Page) =>
  page.getByRole("tabpanel", { name: "Components" });
const category = (page: Page, label: string) =>
  palette(page).getByRole("button", { name: label, exact: true });
const search = (page: Page) =>
  palette(page).getByRole("searchbox", { name: "Search components" });

async function open(page: Page) {
  await page.goto("./");
  await category(page, "Processes").waitFor();
}
async function panelOf(page: Page, label: string) {
  const id = await category(page, label).getAttribute("aria-controls");
  return page.locator(`[id="${id}"]`);
}
async function openAll(page: Page) {
  for (const label of CATEGORIES)
    if (!DEFAULT_OPEN.has(label)) await category(page, label).click();
}
function scriptCatalogue(version: string) {
  const dir = packFor(version, "catalogue/script.json", "catalogue");
  return JSON.parse(
    readFileSync(join(dir, "catalogue/script.json"), "utf8"),
  ) as {
    source: { jarSha256: string };
    operators: { name: string; deprecated: boolean }[];
    factories: { name: string; deprecated: boolean }[];
  };
}
async function expectState(page: Page, label: string, expanded: boolean) {
  await expect(category(page, label)).toHaveAttribute(
    "aria-expanded",
    String(expanded),
  );
  const panel = await panelOf(page, label);
  if (expanded) await expect(panel.locator("li").first()).toBeVisible();
  else await expect(panel).toBeHidden();
}
async function version(page: Page): Promise<string> {
  const text = await page
    .getByRole("heading", { name: /^Nextflow language · / })
    .textContent();
  return (text ?? "").replace(/^.*·\s*/, "").trim();
}

test("F-204 step 1 UX-12: every category expands and collapses with its button", async ({
  page,
}) => {
  await open(page);
  const headings = await palette(page)
    .getByRole("heading", { level: 3 })
    .allInnerTexts();
  expect(headings.map((h) => h.trim())).toEqual(CATEGORIES);
  for (const label of CATEGORIES)
    await expectState(page, label, DEFAULT_OPEN.has(label));
  for (const label of CATEGORIES) {
    const before = DEFAULT_OPEN.has(label);
    await category(page, label).click();
    await expectState(page, label, !before);
    await category(page, label).click();
    await expectState(page, label, before);
  }
});

test("F-204 step 1 UX-12 ADR-0028: the open categories persist after reload, and searching does not change them", async ({
  page,
}) => {
  await open(page);
  await category(page, "Processes").click();
  await category(page, "Channel factories").click();
  await category(page, "Plugins & config").click();
  await search(page).fill("group");
  await search(page).press("Escape");
  await page.reload();
  await category(page, "Processes").waitFor();
  const expected = new Set([
    "Workflows",
    "Operators",
    "Channel factories",
    "Plugins & config",
  ]);
  for (const label of CATEGORIES)
    await expectState(page, label, expected.has(label));
  const stored = await page.evaluate(() =>
    localStorage.getItem("nf-builder:palette"),
  );
  expect(JSON.parse(stored ?? "null")).toEqual({
    state: { open: ["workflows", "factories", "operators", "plugins-config"] },
    version: 1,
  });
});

test("F-204 step 1 UX-12 QA-11: categories toggle from the keyboard with Enter and Space", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  await open(page);
  for (const label of CATEGORIES) {
    const before = DEFAULT_OPEN.has(label);
    const button = category(page, label);
    await button.focus();
    await page.keyboard.press("Enter");
    await expectState(page, label, !before);
    await page.keyboard.press("Space");
    await expectState(page, label, before);
    await expect(button).toBeFocused();
  }
});

test("F-204 step 1 UX-10 UX-02: category state survives switching to Files and back and collapsing and expanding the column", async ({
  page,
}) => {
  await open(page);
  await category(page, "Processes").click();
  await category(page, "Plugins & config").click();
  await page.getByRole("tab", { name: "Files" }).click();
  await page.getByRole("tab", { name: "Components" }).click();
  await expectState(page, "Processes", false);
  await expectState(page, "Plugins & config", true);
  await page
    .getByRole("button", { name: "Collapse components and files" })
    .click();
  await page
    .getByRole("button", { name: "Expand components and files" })
    .click();
  await expectState(page, "Processes", false);
  await expectState(page, "Plugins & config", true);
});

test('F-204 step 2 UX-11 UX-13: searching "group" finds groupBy under Operators, hides other items and empty categories, and never shows groupTuple; Escape restores the state', async ({
  page,
}) => {
  await open(page);
  await category(page, "Operators").click();
  await expectState(page, "Operators", false);
  await search(page).fill("group");
  const operators = await panelOf(page, "Operators");
  await expect(
    operators
      .getByRole("list", { name: "Reduce" })
      .locator(".palette-item-label", { hasText: /^groupBy$/ }),
  ).toBeVisible();
  await expect(
    palette(page).locator(".palette-item-label", { hasText: /^map$/ }),
  ).toHaveCount(0);
  await expect(category(page, "Processes")).toHaveCount(0);
  await expect(palette(page).getByText("groupTuple")).toHaveCount(0);
  await search(page).press("Escape");
  await expect(search(page)).toHaveValue("");
  await expectState(page, "Operators", false);
  await expectState(page, "Processes", true);
  await expectState(page, "Channel factories", false);
});

test("F-204 UX-11: search matches descriptions, ignores case, and says when nothing matches", async ({
  page,
}) => {
  await open(page);
  await search(page).fill("DIRECTORY");
  await expect(
    palette(page).locator(".palette-item-label", { hasText: /^Process$/ }),
  ).toBeVisible();
  await search(page).fill("zzzz");
  await expect(palette(page).getByRole("status")).toHaveText(
    'No components match "zzzz".',
  );
});

test("F-204 step 3 UX-13 ADR-0007: no legacy-only operator or factory appears, every modern one does, and searching a legacy name finds nothing", async ({
  page,
}) => {
  await open(page);
  const v = await version(page);
  const catalogue = scriptCatalogue(v);
  const entries = [...catalogue.operators, ...catalogue.factories];
  const names = new Set(entries.map((e) => e.name));
  const modern = new Set(
    entries.filter((e) => !e.deprecated).map((e) => e.name),
  );
  const legacy = [...names].filter((n) => !modern.has(n));
  expect(legacy).toContain("groupTuple");
  await openAll(page);
  const labels = await palette(page)
    .locator(".palette-item-label")
    .allInnerTexts();
  for (const n of legacy) expect(labels).not.toContain(n);
  for (const n of modern) expect(labels).toContain(n);
  for (const n of ["groupTuple", "branch", "fromFilePairs"]) {
    await search(page).fill(n);
    await expect(palette(page).getByRole("status")).toContainText(
      "No components match",
    );
  }
});

test("F-204 UX-13: only preview items carry the preview badge", async ({
  page,
}) => {
  await open(page);
  const v = await version(page);
  const json = JSON.parse(
    readFileSync(
      join(packFor(v, "palette.yaml", "palette.yaml"), "palette.json"),
      "utf8",
    ),
  ) as {
    categories: {
      items?: { preview?: boolean }[];
      groups?: { items: { preview?: boolean }[] }[];
    }[];
  };
  const previews = json.categories
    .flatMap((c) => [
      ...(c.items ?? []),
      ...(c.groups ?? []).flatMap((g) => g.items),
    ])
    .filter((i) => i.preview).length;
  expect(previews).toBeGreaterThan(0);
  await openAll(page);
  await expect(palette(page).locator(".badge-preview")).toHaveCount(previews);
  await expect(
    palette(page).locator(".palette-item", { hasText: "Agent" }),
  ).toContainText("preview");
});

test("F-204 UX-10: the Components and Files control switches the left column by mouse and keyboard", async ({
  page,
}) => {
  await open(page);
  const components = page.getByRole("tab", { name: "Components" });
  const files = page.getByRole("tab", { name: "Files" });
  await expect(components).toHaveAttribute("aria-selected", "true");
  await files.click();
  await expect(files).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Files" })).toContainText(
    "No project open",
  );
  await expect(palette(page)).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(components).toHaveAttribute("aria-selected", "true");
  await expect(components).toBeFocused();
  await expect(palette(page)).toBeVisible();
});

test("F-204 QA-01 QA-30 ADR-0028: the catalogue loads lazily, outside the initial JavaScript, with no CSP violation or console error", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await open(page);
  const v = await version(page);
  const sha = scriptCatalogue(v).source.jarSha256;
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html, E2E_BASE_PATH);
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(sha);
  const lazy = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `assets/${f}`)
    .filter((f) => !initial.includes(f));
  expect(
    lazy.some((f) => readFileSync(join(WEB_DIST, f), "utf8").includes(sha)),
  ).toBe(true);
  await page.waitForLoadState("load");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
