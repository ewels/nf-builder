import { expect, type Page, test } from "@playwright/test";
import { canvasReady, openFixture, openWorkflow } from "./canvas.ts";

const mode = (page: Page) => page.locator("#canvas-panel");
const radio = (page: Page, name: string) =>
  page.getByRole("radiogroup", { name: "View mode" }).getByRole("radio", {
    name,
  });

test("F-208 step 1 UX-27 AR-30: the toggle switches the active tab between Graph, Split and Code, and each tab keeps its own mode", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await openWorkflow(page, "workflows.nf", "SHOUT");
  await canvasReady(page);
  const main = page.getByRole("tab", { name: "main.nf" });
  const shout = page.getByRole("tab", { name: "SHOUT" });
  const canvas = page.locator(".canvas-area .react-flow");
  const code = page.locator(".code-pane");

  await expect(mode(page)).toHaveAttribute("data-view-mode", "graph");
  await expect(radio(page, "Graph")).toHaveAttribute("aria-checked", "true");
  await expect(code).toHaveCount(0);

  await radio(page, "Split").click();
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
  await expect(radio(page, "Split")).toHaveAttribute("aria-checked", "true");
  await expect(canvas).toBeVisible();
  await expect(code).toBeVisible();
  await expect(code).toHaveAccessibleName("Code of workflows.nf");

  await radio(page, "Code").click();
  await expect(mode(page)).toHaveAttribute("data-view-mode", "code");
  await expect(code).toBeVisible();
  await expect(canvas).toHaveCount(0);

  // the other tab is still in Graph mode, and this one keeps Code
  await main.click();
  await expect(mode(page)).toHaveAttribute("data-view-mode", "graph");
  await expect(code).toHaveCount(0);
  await canvasReady(page);
  await shout.click();
  await expect(mode(page)).toHaveAttribute("data-view-mode", "code");
  await expect(radio(page, "Code")).toHaveAttribute("aria-checked", "true");
  await expect(code).toHaveAccessibleName("Code of workflows.nf");

  // the arrow keys move along the radios
  await radio(page, "Code").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(radio(page, "Split")).toBeFocused();
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
});

test("F-208 step 1 UX-70: G, S and C switch the mode; the same letters typed into the palette search do not", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("s");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
  await page.keyboard.press("C");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "code");
  await page.keyboard.press("g");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "graph");
  await page.keyboard.press("Control+c");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "graph");

  const search = page.getByRole("searchbox", { name: "Search components" });
  await search.click();
  await page.keyboard.type("gsc");
  await expect(search).toHaveValue("gsc");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "graph");
});
