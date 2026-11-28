import { expect, type Page, test } from "@playwright/test";
import { watchForCspViolations } from "./csp.ts";
import {
  largeIndex,
  moduleRow,
  registryRegion,
  routeIndex,
} from "./registry-snapshots.ts";

const REGISTRY_ROUTE = "https://registry.nextflow.io/**";
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search components" });

declare global {
  interface Window {
    __longTasks?: number[];
    __startLongTasks?: () => void;
  }
}

test("F-503 step 1 UX-11 UX-14: searching fastqc shows nf-core/fastqc under Modules in the nf-core group, hides nextflow-io/hello, and shows no 'No components match' status", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.route(REGISTRY_ROUTE, (route) => route.abort());
  await page.goto("./");
  await expect(moduleRow(page, "nf-core/fastqc")).toBeVisible();
  await search(page).fill("fastqc");
  const row = moduleRow(page, "nf-core/fastqc");
  await expect(row).toBeVisible();
  await expect(row).toContainText("fastqc");
  await expect(
    registryRegion(page)
      .locator("#registry-ns-nf-core")
      .locator('[data-name="nf-core/fastqc"]'),
  ).toBeVisible();
  await expect(moduleRow(page, "nextflow-io/hello")).toHaveCount(0);
  await expect(page.getByText("No components match")).toHaveCount(0);
  await expect(page.getByText("No language components match.")).toBeVisible();
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-503 step 2 UX-14: with a 2,500-module snapshot, the nf-core group first shows 100 rows; scrolling the palette loads more (>= 400 after four scrolls) with no long task over 200 ms, and a key typed into search during loading appears at once", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__longTasks = [];
    window.__startLongTasks = () => {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks?.push(e.duration);
      }).observe({ type: "longtask", buffered: true });
    };
  });
  await routeIndex(page, (fixture) => largeIndex(fixture, 2500));
  await page.goto("./");
  const rows = registryRegion(page).locator("#registry-ns-nf-core [data-name]");
  await expect(rows).toHaveCount(100);
  await page.evaluate(() => window.__startLongTasks?.());
  const more = registryRegion(page).getByRole("button", {
    name: /^Show more/,
  });
  for (let i = 0; i < 4; i++) {
    await more.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
  }
  await expect
    .poll(() => rows.count(), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(400);
  await search(page).press("x");
  await expect(search(page)).toHaveValue("x");
  expect(
    (await page.evaluate(() => window.__longTasks ?? [])).filter(
      (d) => d > 200,
    ),
  ).toEqual([]);
});

test("F-503 UX-14: a namespace group collapses and expands, and Plugins lists the fixture plugins with their summaries as titles", async ({
  page,
}) => {
  await page.goto("./");
  const group = registryRegion(page).getByRole("button", { name: /^nf-core/ });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(moduleRow(page, "nf-core/fastqc")).toBeVisible();
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(moduleRow(page, "nf-core/fastqc")).toHaveCount(0);
  await group.click();
  await expect(moduleRow(page, "nf-core/fastqc")).toBeVisible();

  await registryRegion(page)
    .getByRole("button", { name: /^Plugins/ })
    .click();
  const plugins = registryRegion(page).locator("#registry-plugins li");
  await expect(plugins).toHaveCount(2);
  await expect(moduleRow(page, "nf-ffq")).toBeVisible();
  // The fixture's nf-schema summary is the row's title; nf-ffq's is empty.
  await expect(moduleRow(page, "nf-schema")).toHaveAttribute(
    "title",
    /^A Nextflow plugin to work with validation/,
  );
});

test("F-503 UX-11 F-204: searching zzzz still shows one status 'No components match \"zzzz\".'", async ({
  page,
}) => {
  await page.goto("./");
  await expect(moduleRow(page, "nf-core/fastqc")).toBeVisible();
  await search(page).fill("zzzz");
  const status = page.locator(".palette").getByRole("status");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText('No components match "zzzz".');
  await expect(registryRegion(page)).toContainText(
    "No registry modules or plugins match.",
  );
});
