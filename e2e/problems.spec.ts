import { expect, test } from "@playwright/test";
import { openProblemsFixture, problemsReady, statusCount } from "./problems.ts";

test("F-309 step 1 UX-03 LA-34 LA-35: the legacy fixture counts 1 problem and 2 suggestions separately in the status bar", async ({
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
});
