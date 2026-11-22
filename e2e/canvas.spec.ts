import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { REPO_ROOT, WEB_DIST } from "../scripts/check-common.ts";
import { SMOKE_TAG, VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  expectBaseline,
  NODE,
  node,
  nodeClip,
  openBadDeclaration,
  openFixture,
  openProject,
  openWorkflow,
  viewportZoom,
} from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { type EngineHook, readProject } from "./engine.ts";
import { E2E_BASE_PATH } from "./urls.ts";

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

test("F-205 UX-21 UX-22: each node shows its icon, title and subtitle, inputs on the left edge and outputs on the right", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const greeted = node(page, NODE.greeted);
  await expect(greeted.locator("[data-glyph='process'] svg")).toBeVisible();
  await expect(greeted.locator(".canvas-node-title")).toHaveText("GREET");
  await expect(greeted.locator(".canvas-node-subtitle")).toHaveText("process");
  await expect(node(page, NODE.wc).locator(".canvas-node-subtitle")).toHaveText(
    "nf-core/wordcount",
  );
  await expect(
    node(page, NODE.wc).locator("[data-glyph='module'] svg"),
  ).toBeVisible();
  const box = await greeted.boundingBox();
  if (box === null) throw new Error("no node box");
  const centre = box.x + box.width / 2;
  const inputs = greeted.locator(".react-flow__handle.target");
  const outputs = greeted.locator(".react-flow__handle.source");
  expect(await inputs.count()).toBeGreaterThan(0);
  expect(await outputs.count()).toBeGreaterThan(0);
  for (const handle of await inputs.all()) {
    const h = await handle.boundingBox();
    expect((h?.x ?? Number.POSITIVE_INFINITY) < centre).toBe(true);
  }
  for (const handle of await outputs.all()) {
    const h = await handle.boundingBox();
    expect((h?.x ?? 0) > centre).toBe(true);
  }
  await expect(
    greeted.locator(".canvas-port.is-input").first(),
  ).not.toBeEmpty();
});

test("F-205 step 2 UX-23 ADR-0007: typed processes and workflows show the typed badge; legacy processes, workflows and modules show none", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  for (const id of [NODE.greeted, NODE.shouted])
    await expect(node(page, id).locator(".canvas-badge")).toHaveText("typed");
  for (const id of [NODE.counted, NODE.wc, NODE.tail, NODE.params])
    await expect(node(page, id).locator(".canvas-badge")).toHaveCount(0);
});

test("F-205 UX-21: the port labels toggle hides and restores labels and node height", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const greeted = node(page, NODE.greeted);
  const labelled = await greeted.boundingBox();
  const toggle = page.getByRole("button", { name: "Port labels" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(greeted.locator(".canvas-port")).toHaveCount(0);
  await expect
    .poll(async () => (await greeted.boundingBox())?.height ?? 0)
    .toBeLessThan((labelled?.height ?? 0) - 1);
  await toggle.click();
  await expect(greeted.locator(".canvas-port").first()).toBeVisible();
  await expect
    .poll(async () => (await greeted.boundingBox())?.height ?? 0)
    .toBeCloseTo(labelled?.height ?? 0, 0);
});

test('F-205 UX-22: an unparsed callee draws with an error outline and "could not be parsed"', async ({
  page,
}) => {
  await page.goto("./");
  await openBadDeclaration(page);
  await canvasReady(page);
  const bad = page.locator(".canvas-node.is-unparsed");
  await expect(bad).toHaveCount(1);
  await expect(bad.locator(".canvas-node-title")).toHaveText("SECOND");
  await expect(bad.locator(".canvas-node-subtitle")).toHaveText(
    "could not be parsed",
  );
  await expect(bad).toHaveCSS("border-top-width", "2px");
  await expect(bad).toHaveCSS("border-top-color", "rgb(155, 28, 28)");
  await expect(bad.locator("[data-glyph='unparsed'] svg")).toBeVisible();
});

test("F-205 step 2 UX-24 QA-12 LA-28: value edges are dashed, channel edges solid, plain edges dotted", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const dash = (cls: string) =>
    page
      .locator(`.react-flow__edge-path.edge-${cls}`)
      .first()
      .evaluate((el) => getComputedStyle(el).strokeDasharray);
  expect(await dash("channel")).toBe("none");
  expect(await dash("value")).toMatch(/^6(px)?[ ,]+4(px)?$/);
  expect(await dash("plain")).toMatch(/^1(px)?[ ,]+4(px)?$/);
  // unknown: solid like a channel, but muted and thinner than the accent hover (the legacy workflow's output)
  expect(await dash("unknown")).toBe("none");
  const stroke = (cls: string) =>
    page
      .locator(`.react-flow__edge-path.edge-${cls}`)
      .first()
      .evaluate((el) => getComputedStyle(el).stroke);
  expect(await stroke("unknown")).not.toBe(await stroke("channel"));
  const width = (cls: string) =>
    page
      .locator(`.react-flow__edge-path.edge-${cls}`)
      .first()
      .evaluate((el) => getComputedStyle(el).strokeWidth);
  expect(await width("unknown")).toBe("1px");
  expect(await width("channel")).not.toBe("1px");
});

test("F-205 UX-21: node names are in monospace, take and emit pills are grey, and an unparsed node has a grey background", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const family = (loc: Locator) =>
    loc.evaluate((el) => getComputedStyle(el).fontFamily);
  const mono = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono")
      .trim(),
  );
  expect(mono).toContain("monospace");
  const title = node(page, NODE.greeted).locator(".canvas-node-title");
  expect(await family(title)).toBe(mono);
  await openWorkflow(page, "workflows.nf", "SHOUT");
  await canvasReady(page);
  const grey = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      fg: s.getPropertyValue("--tone-grey-fg").trim(),
      bg: s.getPropertyValue("--tone-grey-bg").trim(),
    };
  });
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  for (const kind of ["take", "emit"]) {
    const pill = page.locator(`.canvas-node.is-${kind}`).first();
    await expect(pill).toHaveCSS("border-top-color", rgb(grey.fg));
    await expect(pill).toHaveCSS("background-color", rgb(grey.bg));
    await expect(pill).toHaveCSS("border-top-style", "solid");
    await expect(pill.locator("[data-glyph] ").first()).toHaveClass(
      /tone-grey/,
    );
  }
  await page.goto("./");
  await openBadDeclaration(page);
  await canvasReady(page);
  await expect(page.locator(".canvas-node.is-unparsed")).toHaveCSS(
    "background-color",
    rgb(grey.bg),
  );
});

test("F-205 UX-21: no node title is truncated, including take and emit pills", async ({
  page,
}) => {
  const dir = join(REPO_ROOT, ".cache/corpus/rnaseq-nf-typed");
  if (!existsSync(dir))
    throw new Error(
      "The rnaseq-nf-typed corpus is missing: run pnpm corpus:fetch",
    );
  const truncated = () =>
    page
      .locator(".canvas-node-title")
      .evaluateAll((els) =>
        els
          .filter((el) => el.scrollWidth > el.clientWidth)
          .map((el) => el.textContent),
      );
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await openWorkflow(page, "workflows.nf", "SHOUT");
  await canvasReady(page);
  await expect(page.locator(".canvas-node.is-take")).not.toHaveCount(0);
  expect(await truncated()).toEqual([]);
  await page.goto("./");
  await openProject(page, readProject(dir));
  await canvasReady(page);
  await openWorkflow(page, "modules/rnaseq.nf", "RNASEQ");
  await canvasReady(page);
  await expect(
    page.locator(".canvas-node.is-take", { hasText: "read_pairs_ch" }),
  ).toHaveCount(1);
  expect(await truncated()).toEqual([]);
});

test("F-205 step 3 UX-24: hovering an edge shows its type and source", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  const hover = async (cls: string) => {
    const path = page.locator(`.react-flow__edge-path.edge-${cls}`).first();
    const point = await path.evaluate((el) => {
      const p = el as unknown as SVGPathElement;
      const pt = p.getPointAtLength(p.getTotalLength() / 2);
      const m = p.getScreenCTM();
      if (m === null) throw new Error("no CTM");
      const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
      return { x: s.x, y: s.y };
    });
    await page.mouse.move(point.x, point.y);
  };
  const tooltip = page.getByRole("tooltip");
  await hover("value");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(/^Value<.+> · .+/);
  await hover("channel");
  await expect(tooltip).toHaveText(/^Channel<.+> · .+/);
  await hover("unknown");
  await expect(tooltip).toHaveText("Unknown type · tail");
  await page.mouse.move(2, 2);
  await expect(tooltip).toHaveCount(0);
});

test("F-205 QA-01 ADR-0003: React Flow is only in a lazy chunk", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = new Set(initialJsFiles(manifest, html, E2E_BASE_PATH));
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

test.describe("F-205 node baselines", () => {
  // At this size the fit stays at zoom 1, so a clip is the node at its real size (the test asserts it).
  test.use({ viewport: { width: 2560, height: 1440 } });

  const KINDS: readonly (readonly [string, string])[] = [
    ["process", NODE.greeted],
    ["process-legacy", NODE.counted],
    ["module", NODE.wc],
    ["workflow", NODE.shouted],
    ["workflow-legacy", NODE.tail],
    ["chain", NODE.total],
    ["factory", NODE.names],
    ["params", NODE.params],
    ["output", NODE.output],
    ["code", NODE.code],
  ];

  test(
    "F-205 step 1 UX-21 UX-22 UX-23: each node kind matches its approved baseline",
    {
      tag: VISUAL_TAG,
    },
    async ({ page }, testInfo) => {
      await page.goto("./");
      await openFixture(page);
      await canvasReady(page);
      expect(await viewportZoom(page), "fit stays at zoom 1").toBeCloseTo(1, 2);
      const problems: string[] = [];
      const check = async (name: string, target: Locator) => {
        try {
          await expectBaseline(page, testInfo, `canvas-node-${name}.png`, {
            clip: await nodeClip(target),
          });
        } catch (error) {
          problems.push(String(error instanceof Error ? error.message : error));
        }
      };
      for (const [name, id] of KINDS) await check(name, node(page, id));
      await page.getByRole("button", { name: "Port labels" }).click();
      await expect(page.locator(".canvas-port")).toHaveCount(0);
      await check("process-compact", node(page, NODE.greeted));
      await page.getByRole("button", { name: "Port labels" }).click();
      // take and emit are in the typed named workflow
      await openWorkflow(page, "workflows.nf", "SHOUT");
      await canvasReady(page);
      expect(await viewportZoom(page), "fit stays at zoom 1").toBeCloseTo(1, 2);
      await check("take", page.locator(".canvas-node.is-take").first());
      await check("emit", page.locator(".canvas-node.is-emit").first());
      await page.goto("./");
      await openBadDeclaration(page);
      await canvasReady(page);
      expect(await viewportZoom(page), "fit stays at zoom 1").toBeCloseTo(1, 2);
      await check("unparsed", page.locator(".canvas-node.is-unparsed"));
      expect(problems, problems.join("\n")).toEqual([]);
    },
  );
});

test(
  "F-205 step 1 UX-20 UX-24 UX-26: the rnaseq-nf-typed corpus pipeline's canvases match their approved baselines",
  {
    tag: VISUAL_TAG,
  },
  async ({ page }, testInfo) => {
    const dir = join(REPO_ROOT, ".cache/corpus/rnaseq-nf-typed");
    if (!existsSync(dir))
      throw new Error(
        "The rnaseq-nf-typed corpus is missing: run pnpm corpus:fetch",
      );
    await page.goto("./");
    await openProject(page, readProject(dir));
    await canvasReady(page);
    const centre = page.locator(".column-centre");
    const problems: string[] = [];
    const check = async (name: string) => {
      try {
        await expectBaseline(
          page,
          testInfo,
          `canvas-rnaseq-nf-typed-${name}.png`,
          {
            target: centre,
          },
        );
      } catch (error) {
        problems.push(String(error instanceof Error ? error.message : error));
      }
    };
    await check("entry");
    await openWorkflow(page, "modules/rnaseq.nf", "RNASEQ");
    await canvasReady(page);
    await check("rnaseq");
    expect(problems, problems.join("\n")).toEqual([]);
  },
);
