import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { WEB_DIST } from "../scripts/check-common.ts";
import { SMOKE_TAG, VISUAL_TAG } from "./browsers.ts";
import { expectBaseline } from "./canvas.ts";
import { lazyJsFiles, MONACO_MARKER, monacoChunks } from "./code-view.ts";
import { watchForCspViolations } from "./csp.ts";
import { readProject } from "./engine.ts";
import { historyStatus, typeComment } from "./history.ts";
import {
  auditPreview,
  F605_FIXTURE,
  HOSTILE_README,
  openF605,
  openPathInUi,
  preview,
  recordForeignRequests,
  sentinel,
} from "./markdown.ts";
import { readFile } from "./projects.ts";

const README = readProject(F605_FIXTURE).find((f) => f.path === "README.md");

const mode = (page: import("@playwright/test").Page) =>
  page.locator("#canvas-panel");

test("F-605 step 1 FI-30 QA-31 QA-30: a README containing a script tag previews without executing it", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  const foreign = recordForeignRequests(page);
  await page.goto("./");
  await openF605(page, [{ path: "README.md", text: HOSTILE_README }]);
  await page.getByRole("tab").first().waitFor();
  expect(await openPathInUi(page, "README.md")).toBe("file");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "preview");
  await expect(
    preview(page).getByRole("heading", { name: "Hostile heading" }),
  ).toBeVisible();
  await expect(preview(page)).toContainText("Visible paragraph text.");
  expect(await sentinel(page)).toBeUndefined();
  expect(await auditPreview(page)).toEqual({
    forbidden: [],
    handlerOrStyleAttributes: [],
    unsafeLinks: [],
    imageSources: expect.arrayContaining([
      expect.stringMatching(/^data:image\//),
    ]),
  });
  const audit = await auditPreview(page);
  for (const src of audit.imageSources) expect(src).toMatch(/^data:image\//);
  for (const link of await preview(page).locator("a[href]").all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    const rel = (await link.getAttribute("rel")) ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  }
  expect(foreign()).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-605 AR-32 QA-01: the Markdown preview loads without Monaco, and marked and DOMPurify are not in the initial JavaScript", async ({
  page,
}) => {
  const { initial, lazy } = lazyJsFiles();
  const marker = "f605-markdown-preview-chunk";
  for (const file of initial) {
    const text = readFileSync(join(WEB_DIST, file), "utf8");
    expect(text, file).not.toContain(marker);
    expect(text, file).not.toContain(MONACO_MARKER);
  }
  const holding = lazy.filter((f) =>
    readFileSync(join(WEB_DIST, f), "utf8").includes(marker),
  );
  expect(holding.length).toBeGreaterThan(0);
  for (const file of holding)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(
      MONACO_MARKER,
    );
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await page.goto("./");
  await openF605(page);
  await page.getByRole("tab").first().waitFor();
  await openPathInUi(page, "README.md");
  await expect(preview(page)).toHaveAttribute("data-preview-state", "ready");
  const chunks = monacoChunks().map((f) => `/${f}`);
  const loaded = () =>
    requested.filter((p) => chunks.some((c) => p.endsWith(c)));
  expect(loaded()).toEqual([]);
  await page.keyboard.press("c");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  expect(loaded().length).toBeGreaterThan(0);
});

test("F-605 FI-30 AR-24 AR-23: an edit to README in Split updates the preview and the saved file, and one undo restores the file byte for byte", async ({
  page,
}) => {
  await page.goto("./");
  await openF605(page);
  await page.getByRole("tab").first().waitFor();
  await openPathInUi(page, "README.md");
  await page.getByRole("radio", { name: "Split" }).click();
  await typeComment(page, "Added by the editor");
  await expect(preview(page)).toContainText("Added by the editor");
  await expect
    .poll(() => readFile(page, "README.md"))
    .toContain("Added by the editor");
  await expect
    .poll(async () => (await historyStatus(page)).undo)
    .toBe("Edit README.md");
  await page.getByRole("radio", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect.poll(() => readFile(page, "README.md")).toBe(README?.text);
  await expect(preview(page)).not.toContainText("Added by the editor");
});

test("F-605 FI-30 UX-52: a project link in the preview opens that file in a tab, and a missing one says so", async ({
  page,
}) => {
  await page.goto("./");
  await openF605(page, [
    {
      path: "README.md",
      text: "# Links\n\n[usage](docs/usage.md) [broken](docs/missing.md)\n",
    },
  ]);
  await page.getByRole("tab").first().waitFor();
  await openPathInUi(page, "README.md");
  await preview(page).getByRole("link", { name: "broken" }).click();
  await expect(page.locator(".markdown-pane-status")).toHaveText(
    "docs/missing.md is not in this project.",
  );
  await expect(page.getByRole("tab", { name: "missing.md" })).toHaveCount(0);
  await preview(page).getByRole("link", { name: "usage" }).click();
  await expect(page.getByRole("tab", { name: "usage.md" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(mode(page)).toHaveAttribute("data-view-mode", "preview");
  // by keyboard
  await page.getByRole("tab", { name: "README.md" }).click();
  await preview(page).getByRole("link", { name: "usage" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "usage.md" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("F-605 UX-27 UX-70: a Markdown tab switches Preview, Split and Code with the toggle and with G, S and C; a YAML tab has no toggle", async ({
  page,
}) => {
  await page.goto("./");
  await openF605(page);
  await page.getByRole("tab").first().waitFor();
  await openPathInUi(page, "README.md");
  const radios = page
    .getByRole("radiogroup", { name: "View mode" })
    .getByRole("radio");
  await expect(radios).toHaveText(["Preview", "Split", "Code"]);
  await expect(mode(page)).toHaveAttribute("data-view-mode", "preview");
  await page.keyboard.press("s");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
  await page.keyboard.press("c");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "code");
  await page.keyboard.press("g");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "preview");
  await page.getByRole("radio", { name: "Split" }).click();
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
  await openPathInUi(page, "conf/params.yml");
  await expect(page.getByRole("radiogroup", { name: "View mode" })).toHaveCount(
    0,
  );
  await expect(mode(page)).toHaveAttribute("data-view-mode", "code");
});

test("F-605 FI-32 QA-31: other text files open in Monaco with their extension's language, and an HTML file shows its source without running it", async ({
  page,
}) => {
  await page.goto("./");
  await openF605(page);
  await page.getByRole("tab").first().waitFor();
  await openPathInUi(page, "conf/params.yml");
  await expect(page.locator(".code-editor-host")).toHaveAttribute(
    "data-language",
    "yaml",
  );
  await expect(page.locator(".details-kind")).toHaveText("YAML");
  await openPathInUi(page, "assets/email_template.html");
  await expect(page.locator(".code-editor-host")).toHaveAttribute(
    "data-language",
    "plaintext",
  );
  await expect(page.locator(".monaco-editor")).toContainText("<script>");
  expect(await sentinel(page)).toBeUndefined();
});

test("F-605 FI-31: a .nf file with no workflow opens in Code view with an outline of its declarations in the details pane, and a row shows its declaration in the code", async ({
  page,
}) => {
  await page.goto("./");
  await openF605(page);
  await page.getByRole("tab").first().waitFor();
  expect(await openPathInUi(page, "lib/samples.nf")).toBe("file");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "code");
  const rows = page.locator(".details-outline-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("feature flag");
  await expect(rows.nth(1)).toContainText("enum");
  await expect(rows.nth(2)).toContainText("record");
  await expect(rows.nth(3)).toContainText("function");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await rows.nth(2).click();
  await expect(page.locator(".code-editor-host")).toHaveAttribute(
    "data-selection",
    /^8:1-/,
  );
});

test("F-605 F-703 UX-04: read-only, a Markdown tab shows the sanitised preview only, and another file shows the note", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./");
  await openF605(page);
  await page.getByRole("tab").first().waitFor();
  await openPathInUi(page, "README.md");
  await page.getByRole("radio", { name: "Split" }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(mode(page)).toHaveAttribute("data-view-mode", "preview");
  await expect(preview(page)).toBeVisible();
  await expect(page.locator(".code-pane")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "View mode" })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPathInUi(page, "conf/params.yml");
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator(".read-only-file-note")).toBeVisible();
  await expect(page.locator(".code-pane")).toHaveCount(0);
});

test(
  "F-605 FI-30: the Markdown preview matches its approved baseline",
  {
    tag: VISUAL_TAG,
  },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await openF605(page);
    await page.getByRole("tab").first().waitFor();
    await openPathInUi(page, "README.md");
    await expect(preview(page)).toHaveAttribute("data-preview-state", "ready");
    await expectBaseline(page, testInfo, "markdown-preview.png", {
      target: preview(page),
    });
  },
);
