import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openFixture } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { historyStatus } from "./history.ts";
import {
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
const mainOf = (dir: string) => readFileSync(join(dir, "main.nf"), "utf8");

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
  const before = mainOf(F309_FIXTURE);
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
  expect(await readFile(page, "main.nf")).toBe(mainOf(F309_FIXED));
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
