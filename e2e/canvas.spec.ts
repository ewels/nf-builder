import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { WEB_DIST } from "../scripts/check-common.ts";
import { SMOKE_TAG } from "./browsers.ts";
import {
  canvasReady,
  openFixture,
  openWorkflow,
  viewportZoom,
} from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import type { EngineHook } from "./engine.ts";

interface Counts {
  nodes: number;
  edges: number;
}

test("F-205 step 1 UX-20 AR-10 QA-30: opening a fixture shows the entry workflow tab with one node per projection node and one edge per edge, and no CSP violation or console error", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const expected = await page.evaluate(async (): Promise<Counts> => {
    const engine = (window as unknown as { nfBuilderEngine: EngineHook })
      .nfBuilderEngine;
    const result = (await engine.project("main.nf", null)) as {
      projection: { nodes: unknown[]; edges: unknown[] };
    };
    return {
      nodes: result.projection.nodes.length,
      edges: result.projection.edges.length,
    };
  });
  const tab = page.getByRole("tab", { name: "main.nf" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tablist", { name: "Workflows" }).getByRole("tab"),
  ).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(expected.nodes);
  await expect(page.locator(".react-flow__edge")).toHaveCount(expected.edges);
  await expect(page.getByRole("contentinfo")).toContainText(
    `${expected.nodes} nodes · ${expected.edges} channels`,
  );
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-205 UX-20 QA-11: opening a named workflow adds a selected tab; the arrow keys and clicks switch canvases", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await openWorkflow(page, "workflows.nf", "SHOUT");
  const shout = page.getByRole("tab", { name: "SHOUT" });
  const main = page.getByRole("tab", { name: "main.nf" });
  await expect(shout).toHaveAttribute("aria-selected", "true");
  await expect(main).toHaveAttribute("aria-selected", "false");
  await canvasReady(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await shout.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(main).toHaveAttribute("aria-selected", "true");
  await expect(main).toBeFocused();
  await expect(page.locator("#canvas-panel")).toHaveAttribute(
    "aria-labelledby",
    /main\.nf#/,
  );
  await canvasReady(page);
  await expect(page.locator(".react-flow__node")).not.toHaveCount(4);
  await shout.click();
  await expect(shout).toHaveAttribute("aria-selected", "true");
  await canvasReady(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});

test("F-205 UX-26: zoom in and out change the zoom, fit view brings every node into view, and the minimap shows every node", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const total = await page.locator(".react-flow__node").count();
  const start = await viewportZoom(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => viewportZoom(page)).toBeGreaterThan(start);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(() => viewportZoom(page)).toBeLessThan(start);
  await page.getByRole("button", { name: "Fit view" }).click();
  await expect.poll(() => viewportZoom(page)).toBeCloseTo(start, 1);
  const pane = await page.locator(".react-flow").boundingBox();
  if (pane === null) throw new Error("no canvas");
  const nodes = page.locator(".react-flow__node");
  for (let i = 0; i < total; i++) {
    const box = await nodes.nth(i).boundingBox();
    if (box === null) throw new Error("no node box");
    expect(box.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(pane.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
  }
  await expect(page.getByRole("img", { name: "Minimap" })).toBeVisible();
  await expect(page.locator(".react-flow__minimap-node")).toHaveCount(total);
});

test("F-205 QA-01 ADR-0003: React Flow is only in a lazy chunk", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = new Set(initialJsFiles(manifest, html));
  const canvas = Object.entries(manifest).find(([key]) =>
    key.endsWith("canvas/workflow-canvas.tsx"),
  );
  expect(canvas, "the canvas module is a manifest entry").toBeDefined();
  expect(canvas?.[1].isDynamicEntry).toBe(true);
  expect(initial.has(canvas?.[1].file ?? "")).toBe(false);
  // the React Flow runtime is not in any initial file
  for (const file of initial)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(
      "react-flow__viewport",
    );
  expect(
    readdirSync(join(WEB_DIST, "assets")).some((f) =>
      readFileSync(join(WEB_DIST, "assets", f), "utf8").includes(
        "react-flow__viewport",
      ),
    ),
  ).toBe(true);
});
