import { expect, test } from "@playwright/test";
import { VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  expectBaseline,
  layoutSettled,
  node,
  openBadDeclaration,
  openFixture,
} from "./canvas.ts";
import { fileText } from "./code-view.ts";
import { watchForCspViolations } from "./csp.ts";
import { historyStatus } from "./history.ts";
import {
  editorSelection,
  engineDiagnostics,
  F309_FIXED,
  F309_FIXTURE,
  openProblemsFixture,
  problemRow,
  problemsPanel,
  problemsReady,
  statusCount,
} from "./problems.ts";
import { readFile } from "./projects.ts";

const FIX_TITLE = "Replace `Channel` with `channel`";

test("F-309 step 1 UX-03 LA-34 LA-35: the legacy fixture counts 1 problem and 2 suggestions separately, and the panel lists each under its own tab", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await expect(problemsReady(page)).toBeVisible();
  const problems = statusCount(page, "problems");
  const suggestions = statusCount(page, "suggestions");
  await expect(problems).toHaveAccessibleName("1 problem");
  await expect(problems).toHaveAttribute("title", "0 errors, 1 warning");
  await expect(suggestions).toHaveAccessibleName("2 suggestions");
  await expect(problems).toHaveAttribute("aria-expanded", "false");
  await expect(problemsPanel(page)).toHaveCount(0);

  await problems.click();
  const panel = problemsPanel(page);
  await expect(panel).toBeVisible();
  await expect(problems).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("tab", { name: "Problems 1" })).toBeFocused();
  await expect(panel.getByRole("tab", { name: "Suggestions 2" })).toBeVisible();
  await expect(problemRow(page)).toHaveCount(1);
  await expect(problemRow(page, "deprecated-channel")).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: /^main\.nf/ })).toBeVisible();

  await suggestions.click();
  await expect(problemRow(page)).toHaveCount(2);
  await expect(problemRow(page, "deprecated-channel")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: /^main\.nf/ })).toBeVisible();
  await expect(
    panel.getByRole("heading", {
      name: /^modules\/local\/legacy_count\/main\.nf/,
    }),
  ).toBeVisible();
  await expect(problemRow(page, "legacy-workflow")).toHaveCount(1);
  await expect(problemRow(page, "legacy-process")).toHaveCount(1);
  // the same count button closes the panel
  await suggestions.click();
  await expect(problemsPanel(page)).toHaveCount(0);
});

test("F-309 UX-03 AR-05: the panel lists exactly the engine's diagnostics", async ({
  page,
}) => {
  await page.goto("./");
  for (const open of [openProblemsFixture, openFixture]) {
    await open(page);
    await expect(problemsReady(page)).toBeVisible();
    const diagnostics = await engineDiagnostics(page);
    const count = (...severities: string[]) =>
      diagnostics.filter((d) => severities.includes(d.severity)).length;
    await statusCount(page, "problems").click();
    await expect(problemRow(page)).toHaveCount(count("error", "warning"));
    for (const severity of ["error", "warning"]) {
      await expect(
        problemsPanel(page).locator(`.problem-row.is-${severity}`),
      ).toHaveCount(count(severity));
    }
    await statusCount(page, "suggestions").click();
    await expect(problemRow(page)).toHaveCount(count("suggestion"));
    await statusCount(page, "suggestions").click();
    await expect(problemsPanel(page)).toHaveCount(0);
  }
});

test("F-309 step 2 ADR-0042 AR-23: applying the Channel.of quick fix removes the warning and writes channel.of; one undo restores the file and the warning", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await openProblemsFixture(page);
  await expect(problemsReady(page)).toBeVisible();
  const before = fileText(F309_FIXTURE);
  expect(await readFile(page, "main.nf")).toBe(before);
  await statusCount(page, "problems").click();
  await problemsPanel(page).getByRole("button", { name: FIX_TITLE }).click();

  await expect(statusCount(page, "problems")).toHaveAccessibleName(
    "No problems",
  );
  await expect(statusCount(page, "suggestions")).toHaveAccessibleName(
    "2 suggestions",
  );
  await expect(problemsPanel(page).getByText("No problems")).toBeVisible();
  await expect(problemsPanel(page)).toContainText(`Applied: ${FIX_TITLE}`);
  expect(await readFile(page, "main.nf")).toBe(fileText(F309_FIXED));
  const status = await historyStatus(page);
  expect(status.undoCount).toBe(1);
  expect(status.undo).toBe(FIX_TITLE);

  // focus is in the panel (the list, now empty), which does not take the undo key
  await page.keyboard.press("ControlOrMeta+z");
  await expect(statusCount(page, "problems")).toHaveAccessibleName("1 problem");
  expect(await readFile(page, "main.nf")).toBe(before);
  await expect(problemRow(page, "deprecated-channel")).toHaveCount(1);
  expect((await historyStatus(page)).undoCount).toBe(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-309 UX-70 QA-11: the status bar, the panel's tabs, rows and fix buttons work by keyboard, and Escape returns focus to the status bar", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await expect(problemsReady(page)).toBeVisible();
  const panel = problemsPanel(page);
  await statusCount(page, "problems").focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("tab", { name: "Problems 1" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("tab", { name: "Suggestions 2" })).toBeFocused();
  await expect(
    panel.getByRole("tab", { name: "Suggestions 2" }),
  ).toHaveAttribute("aria-selected", "true");
  // the close button, then the list's one tab stop
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const goButtons = panel.locator(".problem-go");
  await expect(goButtons.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(goButtons.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(goButtons.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(goButtons.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(problemsPanel(page)).toHaveCount(0);
  await expect(statusCount(page, "suggestions")).toBeFocused();

  // the fix button by keyboard
  await statusCount(page, "problems").focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("tab", { name: "Problems 1" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(panel.locator(".problem-go").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(panel.locator(".problem-fix")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(panel.locator(".problem-go").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(statusCount(page, "problems")).toHaveAccessibleName(
    "No problems",
  );
});

test("F-309 UX-30: activating a problem inside a node selects and centres that node, and the details pane lists the problem", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await canvasReady(page);
  await expect(problemsReady(page)).toBeVisible();
  // pan away first, so the node is out of view
  const pane = page.locator(".react-flow__pane");
  const box = await pane.boundingBox();
  if (box === null) throw new Error("no canvas pane");
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 40 + 900, box.y + 40 + 700, { steps: 8 });
  await page.mouse.up();
  const numbers = node(page, "main.nf#/numbers");
  const canvas = page.locator(".workflow-canvas");
  const inside = async () => {
    const n = await numbers.boundingBox();
    const c = await canvas.boundingBox();
    if (n === null || c === null) return false;
    return (
      n.x >= c.x &&
      n.y >= c.y &&
      n.x + n.width <= c.x + c.width &&
      n.y + n.height <= c.y + c.height
    );
  };
  expect(await inside()).toBe(false);

  await statusCount(page, "problems").click();
  const go = problemRow(page, "deprecated-channel").locator(".problem-go");
  await go.click();
  await expect(numbers).toHaveClass(/selected/);
  await expect.poll(inside).toBe(true);
  await expect(page.locator(".details-name")).toHaveText("channel.of");
  await expect(page.locator(".details-problem")).toContainText(
    "to access channel factories is deprecated",
  );
  // the focus stays in the panel
  await expect(go).toBeFocused();
});

test("F-309 UX-27: activating a problem outside every node shows its file's code in Split view with the problem selected", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await canvasReady(page);
  await expect(problemsReady(page)).toBeVisible();
  await statusCount(page, "suggestions").click();
  const go = problemRow(page, "legacy-workflow").locator(".problem-go");
  await go.click();
  await expect(page.locator(".tab-panel")).toHaveAttribute(
    "data-view-mode",
    "split",
  );
  await expect.poll(() => editorSelection(page)).toBe("3:1-3:9");
  await expect(go).toBeFocused();
});

test("F-309 UX-20: activating a problem in a file without a workflow opens a Code tab for that file at the problem", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await expect(problemsReady(page)).toBeVisible();
  await statusCount(page, "suggestions").click();
  const go = problemRow(page, "legacy-process").locator(".problem-go");
  await go.click();
  const tab = page.getByRole("tab", { name: "legacy_count/main.nf" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveAttribute(
    "title",
    "modules/local/legacy_count/main.nf",
  );
  await expect(page.locator(".tab-panel")).toHaveAttribute(
    "data-view-mode",
    "code",
  );
  await expect(page.locator(".workflow-canvas")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "View mode" })).toHaveCount(
    0,
  );
  await expect.poll(() => editorSelection(page)).toBe("1:9-1:21");
  await expect(go).toBeFocused();
  // G, S and C do nothing on a file tab
  await page.locator("body").press("s");
  await expect(page.locator(".tab-panel")).toHaveAttribute(
    "data-view-mode",
    "code",
  );
  // the workflow's tab is still there
  await page.getByRole("tab", { name: "main.nf", exact: true }).click();
  await expect(page.locator(".tab-panel")).toHaveAttribute(
    "data-view-mode",
    "graph",
  );
});

test("F-309 LA-30: a syntax error is listed under Problems as an error and opens the code at its position", async ({
  page,
}) => {
  await page.goto("./");
  await openBadDeclaration(page);
  await expect(problemsReady(page)).toBeVisible();
  await statusCount(page, "problems").click();
  const errors = problemsPanel(page).locator(".problem-row.is-error");
  await expect(errors.first()).toContainText("Error");
  const location =
    (await errors.first().locator(".problem-location").textContent()) ?? "";
  await errors.first().locator(".problem-go").click();
  await expect(page.locator(".tab-panel")).toHaveAttribute(
    "data-view-mode",
    "split",
  );
  await expect
    .poll(async () => (await editorSelection(page))?.split("-")[0])
    .toBe(location);
});

test(
  "F-309 UX-03: the problems panel and the status-bar counts match their approved baselines @visual",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await openProblemsFixture(page);
    await canvasReady(page);
    await expect(problemsReady(page)).toBeVisible();
    await statusCount(page, "problems").click();
    await expect(problemRow(page)).toHaveCount(1);
    await layoutSettled(page);
    await expectBaseline(page, testInfo, "problems-panel.png", {
      target: problemsPanel(page),
    });
    await expectBaseline(page, testInfo, "problems-status-bar.png", {
      target: page.locator("footer.status-bar"),
    });
  },
);
