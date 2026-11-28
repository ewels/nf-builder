import { expect, test } from "@playwright/test";
import {
  canvasReady,
  clickEmptyCanvas,
  node,
  selectNode,
  viewportZoom,
} from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  currentFiles,
  openStoredFixture,
  pressUndo,
  storedFiles,
} from "./history.ts";
import { CONFIGURE_START, GREET_NODE, popup } from "./popup.ts";
import { problemsPanel, problemsReady, statusCount } from "./problems.ts";
import {
  applyOutcome,
  NARROW,
  READ_ONLY_ALLOWED,
  resize,
  visibleControls,
} from "./read-only.ts";
import {
  ALIGN_PATH,
  ALIGNED,
  breadcrumb,
  inputPorts,
  MAPPED,
  openAlignFixture,
  tabNamed,
} from "./workflow-tabs.ts";

/** The project's Nextflow files: opening a tab lays its workflow out, which writes the sidecar but isn't an edit. */
const scripts = async (page: import("@playwright/test").Page) =>
  Object.fromEntries(
    Object.entries(await currentFiles(page)).filter(([p]) => p.endsWith(".nf")),
  );

const TAKE = `${ALIGN_PATH}#ALIGN/:take:reads`;
const EMIT = `${ALIGN_PATH}#ALIGN/:emit:bam`;
const sortCall = (page: import("@playwright/test").Page) =>
  page.locator(".react-flow__node").filter({ hasText: "SORT" }).first();

test("F-307 step 1 UX-50 UX-51: double-clicking ALIGN opens its tab with take and emit pills", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openAlignFixture(page, "tabs-open");
  const zoom = await viewportZoom(page);
  await node(page, ALIGNED).locator(".canvas-node-title").first().dblclick();
  await expect(tabNamed(page, "ALIGN")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await canvasReady(page);
  await expect(node(page, TAKE)).toBeVisible();
  await expect(node(page, EMIT)).toBeVisible();
  const [take, emit] = await Promise.all([
    node(page, TAKE).boundingBox(),
    node(page, EMIT).boundingBox(),
  ]);
  expect(take?.x).toBeLessThan(emit?.x ?? 0);
  await tabNamed(page, "main.nf").click();
  await canvasReady(page);
  expect(await viewportZoom(page)).toBeCloseTo(zoom, 5);
});

test("F-307 step 2 UX-51: adding a take in ALIGN gives the ALIGN node in main.nf a new input port", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openAlignFixture(page, "tabs-take");
  const before = await scripts(page);
  await node(page, ALIGNED).locator(".canvas-node-title").first().dblclick();
  await expect(node(page, TAKE)).toBeVisible();
  await clickEmptyCanvas(page);
  await page.getByRole("button", { name: "Add take" }).click();
  const form = page.getByRole("form", { name: "Add take" });
  await form.getByLabel("Name").fill("index");
  await form.getByLabel("Type").fill("Channel<String>");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added take index to ALIGN.")).toBeAttached();
  await tabNamed(page, "main.nf").click();
  await canvasReady(page);
  await expect
    .poll(() => inputPorts(page, ALIGNED))
    .toEqual(["reads", "index"]);
  await expect(problemsReady(page)).toBeVisible();
  await statusCount(page, "problems").click();
  await expect(problemsPanel(page)).toContainText(
    "Workflow `ALIGN` expects 2 argument(s)",
  );
  await pressUndo(page);
  await expect.poll(() => scripts(page)).toEqual(before);
});

test("F-307 step 3 UX-50: the breadcrumb's main.nf returns to main.nf", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openAlignFixture(page, "tabs-crumbs");
  await node(page, ALIGNED).locator(".canvas-node-title").first().dblclick();
  await expect(node(page, TAKE)).toBeVisible();
  await sortCall(page).locator(".canvas-node-title").first().dblclick();
  await expect(tabNamed(page, "SORT")).toHaveAttribute("aria-selected", "true");
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText([
    /main\.nf/,
    /ALIGN/,
    /SORT/,
  ]);
  await breadcrumb(page).getByRole("button", { name: "ALIGN" }).click();
  await expect(tabNamed(page, "ALIGN")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await breadcrumb(page).getByRole("button", { name: "main.nf" }).click();
  await expect(tabNamed(page, "main.nf")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("F-307 UX-70 UX-40: Enter on a selected workflow node opens its tab", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openAlignFixture(page, "tabs-keys");
  await clickEmptyCanvas(page);
  await node(page, ALIGNED).focus();
  await page.keyboard.press("Enter");
  await expect(node(page, ALIGNED)).toHaveClass(/selected/);
  await expect(tabNamed(page, "ALIGN")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(tabNamed(page, "ALIGN")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("F-307 UX-40 UX-70: Enter on a selected process opens the popup, not a tab", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "tabs-keys-process", CONFIGURE_START);
  const strip = page
    .getByRole("tablist", { name: "Open workflows and files" })
    .getByRole("tab");
  const open = await strip.count();
  await clickEmptyCanvas(page);
  await node(page, GREET_NODE).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(popup(page)).toBeVisible();
  await expect(strip).toHaveCount(open);
});

test("F-307 UX-50: an aliased call opens the definition's tab once", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openAlignFixture(page, "tabs-alias");
  await node(page, MAPPED).locator(".canvas-node-title").first().dblclick();
  await expect(tabNamed(page, "ALIGN")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await tabNamed(page, "main.nf").click();
  await node(page, ALIGNED).locator(".canvas-node-title").first().dblclick();
  await expect(tabNamed(page, "ALIGN")).toHaveCount(1);
});

test("F-307 UX-04 ADR-0056: read-only, double-click opens a workflow tab and the breadcrumb works; no Add take", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openAlignFixture(page, "tabs-readonly");
  await resize(page, NARROW);
  await canvasReady(page);
  await selectNode(page, ALIGNED);
  await node(page, ALIGNED).locator(".canvas-node-title").first().dblclick();
  await expect(tabNamed(page, "ALIGN")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    breadcrumb(page).getByRole("button", { name: "main.nf" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add take" })).toHaveCount(0);
  const unexpected = (await visibleControls(page)).filter(
    (c) => !READ_ONLY_ALLOWED.some((allowed) => allowed.test(c)),
  );
  expect(unexpected).toEqual([]);
  const refused = await applyOutcome(page, {
    kind: "addTake",
    target: { path: ALIGN_PATH, workflow: "ALIGN" },
    name: "x",
    type: "Channel<String>",
  });
  expect(refused.ok).toBe(false);
  await breadcrumb(page).getByRole("button", { name: "main.nf" }).click();
  await expect(tabNamed(page, "main.nf")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("F-307 QA-30: opening tabs and adding a take log no CSP violation and no console error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await openAlignFixture(page, "tabs-csp");
  await node(page, ALIGNED).locator(".canvas-node-title").first().dblclick();
  await expect(node(page, TAKE)).toBeVisible();
  await clickEmptyCanvas(page);
  await page.getByRole("button", { name: "Add take" }).click();
  const form = page.getByRole("form", { name: "Add take" });
  await form.getByLabel("Name").fill("index");
  await form.getByLabel("Type").fill("Channel<String>");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added take index to ALIGN.")).toBeAttached();
  await storedFiles(page);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
