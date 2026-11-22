import { expect, type Page, test } from "@playwright/test";
import { VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  clickEmptyCanvas,
  expectBaseline,
  layoutSettled,
  NODE,
  node,
  openBadDeclaration,
  openFixture,
  openWorkflow,
  selectNode,
} from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  calleeNodeId,
  DETAILS_EXPECTED,
  detailsPane,
  detailsReady,
  detailsSection,
  type ExpectedDetails,
  openDetailsFixture,
  projectionOf,
  readPorts,
  SECOND_EXPECTED,
  SECOND_ID,
  SHOUT_EXPECTED,
  TRIM_ID,
} from "./details.ts";

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Clicks a node and checks the pane against `expected` once the worker's part has arrived. */
async function expectDetails(
  page: Page,
  id: string,
  expected: ExpectedDetails,
): Promise<void> {
  await selectNode(page, id);
  const pane = detailsPane(page);
  await expect(pane.locator(".details-name"), id).toHaveText(expected.name);
  await detailsReady(page);
  await expect(pane.locator(".details-kind"), id).toHaveText(expected.kind);
  await expect(pane.locator(".details-file"), id).toHaveText(
    new RegExp(`^${escapeRegExp(expected.file)}(:\\d+)?$`),
  );
  expect(await readPorts(page, "Inputs"), `${id} inputs`).toEqual(
    expected.inputs,
  );
  expect(await readPorts(page, "Outputs"), `${id} outputs`).toEqual(
    expected.outputs,
  );
}

const detailsColumn = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });

test("F-206 UX-24: edges touching the selected node are highlighted until the selection clears", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const { edges } = await projectionOf(page, "main.nf", null);
  const touching = edges.filter(
    (e) => e.from.node === NODE.greeted || e.to.node === NODE.greeted,
  ).length;
  expect(touching).toBeGreaterThan(0);
  const highlighted = page.locator(".react-flow__edge-path.is-highlighted");
  await expect(highlighted).toHaveCount(0);
  await selectNode(page, NODE.greeted);
  await expect(node(page, NODE.greeted)).toHaveClass(/selected/);
  await expect(highlighted).toHaveCount(touching);
  const stroke = await highlighted
    .first()
    .evaluate((el) => [
      getComputedStyle(el).stroke,
      getComputedStyle(el).strokeWidth,
    ]);
  expect(stroke).toEqual(["rgb(47, 95, 208)", "3px"]);
  await selectNode(page, NODE.counted);
  await expect(node(page, NODE.greeted)).not.toHaveClass(/selected/);
  await expect(node(page, NODE.counted)).toHaveClass(/selected/);
  await clickEmptyCanvas(page);
  await expect(highlighted).toHaveCount(0);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
});

test("F-206 UX-30: selecting a node keeps the viewport", async ({ page }) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await layoutSettled(page);
  const transform = () =>
    page
      .locator(".react-flow__viewport")
      .evaluate((el) => getComputedStyle(el).transform);
  const before = await transform();
  await selectNode(page, NODE.greeted);
  await expect(node(page, NODE.greeted)).toHaveClass(/selected/);
  await detailsReady(page);
  expect(await transform()).toBe(before);
  await selectNode(page, NODE.counted);
  await expect(node(page, NODE.counted)).toHaveClass(/selected/);
  expect(await transform()).toBe(before);
});

test("F-206 step 1 UX-30: clicking each node kind shows its name, kind, file, and ports with types and connections", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  for (const [id, expected] of Object.entries(DETAILS_EXPECTED))
    await expectDetails(page, id, expected);
  await openWorkflow(page, "workflows.nf", "SHOUT");
  await canvasReady(page);
  for (const [id, expected] of Object.entries(SHOUT_EXPECTED))
    await expectDetails(page, id, expected);
  await openBadDeclaration(page);
  await canvasReady(page);
  await expectDetails(page, SECOND_ID, SECOND_EXPECTED);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-206 step 1 UX-30: every node's details list one row per projected port", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const sweeps: [string, string | null][] = [
    ["main.nf", null],
    ["workflows.nf", "SHOUT"],
    ["legacy.nf", "LEGACY_TAIL"],
  ];
  let seen = 0;
  for (const [path, workflow] of sweeps) {
    if (workflow !== null) {
      await openWorkflow(page, path, workflow);
      await canvasReady(page);
    }
    for (const n of (await projectionOf(page, path, workflow)).nodes) {
      await selectNode(page, n.id);
      await expect(
        detailsSection(page, "Inputs").locator(":scope > ul > li"),
        n.id,
      ).toHaveCount(n.inputs.length);
      await expect(
        detailsSection(page, "Outputs").locator(":scope > ul > li"),
        n.id,
      ).toHaveCount(n.outputs.length);
      seen++;
    }
  }
  expect(seen).toBeGreaterThan(15);
});

test("F-206 UX-30 LA-20: a typed process shows its description, directives, topics and a short script preview", async ({
  page,
}) => {
  await page.goto("./");
  await openDetailsFixture(page);
  await canvasReady(page);
  await selectNode(page, TRIM_ID);
  await detailsReady(page);
  const pane = detailsPane(page);
  await expect(pane.locator(".details-description")).toContainText(
    "Trims a name and greets it.",
  );
  await expect(pane.locator(".details-description")).not.toContainText(
    "@param",
  );
  const section = (title: string) => detailsSection(page, title);
  await expect(section("Directives").locator("li")).toHaveCount(4);
  for (const name of ["tag", "label", "cpus", "container"])
    await expect(section("Directives")).toContainText(name);
  await expect(section("Topics")).toContainText("versions");
  await expect(section("Script").locator("pre")).toContainText("set -eu");
  const lines = (
    (await section("Script").locator("pre").textContent()) ?? ""
  ).split("\n");
  expect(lines.length).toBeLessThanOrEqual(8);
  await expect(section("Script")).toContainText("Showing the first lines only");
});

test("F-206 UX-30 AR-05: a node's problems show in its details", async ({
  page,
}) => {
  await page.goto("./");
  await openDetailsFixture(page);
  await canvasReady(page);
  const problems = detailsSection(page, "Problems");
  await selectNode(page, await calleeNodeId(page, "LEGACY_VERSIONS"));
  await detailsReady(page);
  await expect(problems).toContainText("Suggestion");
  await selectNode(page, TRIM_ID);
  await expect(detailsPane(page).locator(".details-name")).toHaveText("TRIM");
  await detailsReady(page);
  await expect(problems).toContainText("No problems found");
  await openBadDeclaration(page);
  await canvasReady(page);
  await selectNode(page, SECOND_ID);
  await expect(detailsPane(page).locator(".details-name")).toHaveText("SECOND");
  await detailsReady(page);
  await expect(problems).toContainText("Error");
});

test("F-206 step 2 UX-31: clicking empty canvas shows the workflow summary with take, emit, calls and registry modules", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const pane = detailsPane(page);
  await expect(pane).toHaveAttribute("data-details-state", "summary");
  await expect(pane.locator(".details-name")).toHaveText("Entry workflow");
  await selectNode(page, NODE.greeted);
  await expect(pane).toHaveAttribute("data-details-state", /ready|loading/);
  await clickEmptyCanvas(page);
  await expect(pane).toHaveAttribute("data-details-state", "summary");
  const section = (title: string) => detailsSection(page, title);
  await expect(section("Calls")).toContainText("GREET");
  await expect(section("Calls")).toContainText("WORDCOUNT");
  await expect(section("Registry modules")).toContainText("nf-core/wordcount");
  await expect(section("Parameters")).toContainText("greeting");
  await expect(section("Outputs")).toContainText("greetings");
  await openWorkflow(page, "workflows.nf", "SHOUT");
  await canvasReady(page);
  await expect(pane.locator(".details-name")).toHaveText("SHOUT");
  await expect(section("Take")).toContainText("names");
  await expect(section("Take")).toContainText("words");
  await expect(section("Emit")).toContainText("loud");
});

test("F-206 UX-32: Edit and Code show, disabled, only while a node is selected", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const column = detailsColumn(page);
  await expect(column.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await selectNode(page, NODE.greeted);
  for (const name of ["Edit", "Code"])
    await expect(column.getByRole("button", { name })).toBeDisabled();
  await clickEmptyCanvas(page);
  await expect(column.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(column.getByRole("button", { name: "Code" })).toHaveCount(0);
});

test(
  "F-206 UX-30 UX-32: a typed process's details match the approved baseline @visual",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await openDetailsFixture(page);
    await canvasReady(page);
    await selectNode(page, TRIM_ID);
    await detailsReady(page);
    await expect(detailsPane(page).locator(".details-name")).toHaveText("TRIM");
    await layoutSettled(page);
    await expectBaseline(page, testInfo, "details-process-trim.png", {
      target: detailsColumn(page),
    });
  },
);

test(
  "F-206 UX-31: the entry workflow summary matches the approved baseline @visual",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await openFixture(page);
    await canvasReady(page);
    await expect(detailsPane(page)).toHaveAttribute(
      "data-details-state",
      "summary",
    );
    await layoutSettled(page);
    await expectBaseline(page, testInfo, "details-entry-summary.png", {
      target: detailsColumn(page),
    });
  },
);
