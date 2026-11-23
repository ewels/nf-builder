import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  initialJsFiles,
  type Manifest,
} from "../scripts/check-bundle-budget.ts";
import { WEB_DIST } from "../scripts/check-common.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { canvasReady, node, selectNode } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  dragNode,
  KEY,
  nodeBoxes,
  nodePosition,
  openStoredProject,
  overlaps,
  readSidecar,
  SIDECAR,
  waitSaved,
} from "./layout.ts";
import { E2E_BASE_PATH } from "./urls.ts";

const ALL_KEYS = [KEY.reads, KEY.more, KEY.fromPath, KEY.view, KEY.count];
const notices = (page: Page) => page.locator(".canvas-notices");

test("F-207 step 1 ADR-0008 IO-02 QA-30: opening a project without a sidecar lays out every node without overlap and writes the sidecar with every node's position", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await openStoredProject(page);
  const boxes = await nodeBoxes(page);
  expect(boxes.map((b) => b.id).sort()).toEqual([...ALL_KEYS].sort());
  expect(overlaps(boxes)).toEqual([]);
  // the projection's edges run from left to right
  const projection = (await page.evaluate(() =>
    (
      window as unknown as {
        nfBuilderEngine: {
          project(p: string, w: null): Promise<{ projection: Projection }>;
        };
      }
    ).nfBuilderEngine.project("main.nf", null),
  )) as { projection: Projection };
  expect(projection.projection.edges.length).toBeGreaterThan(0);
  for (const e of projection.projection.edges) {
    const from = boxes.find((b) => b.id === e.from.node);
    const to = boxes.find((b) => b.id === e.to.node);
    expect(from && to, `${e.from.node} to ${e.to.node}`).toBeTruthy();
    expect((from?.x ?? 0) + (from?.width ?? 0)).toBeLessThanOrEqual(
      (to?.x ?? 0) + 0.5,
    );
  }
  const stored = await waitSaved(page);
  expect(stored).not.toBeNull();
  const sidecar = await readSidecar(page);
  expect(Object.keys(sidecar?.nodes ?? {}).sort()).toEqual(
    boxes.map((b) => b.id).sort(),
  );
  expect(JSON.parse(stored ?? "{}")).toEqual(sidecar);
  for (const id of boxes.map((b) => b.id))
    expect(await nodePosition(page, id)).toEqual(sidecar?.nodes[id]);
  await expect(notices(page)).toHaveText("");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-207 step 2 IO-02 IO-01: a moved node is at the same position after reload", async ({
  page,
}) => {
  await openStoredProject(page);
  const before = await nodePosition(page, KEY.reads);
  await dragNode(page, KEY.reads, 0, -60);
  const moved = await nodePosition(page, KEY.reads);
  expect(moved.y).toBeLessThan(before.y);
  await waitSaved(page);
  await expect
    .poll(async () => (await readSidecar(page))?.nodes[KEY.reads])
    .toEqual(moved);
  await page.reload();
  await canvasReady(page);
  expect(await nodePosition(page, KEY.reads)).toEqual(moved);
});

test("F-207 UX-30 IO-02: a node moved with the arrow keys is saved", async ({
  page,
}) => {
  await openStoredProject(page);
  await selectNode(page, KEY.more);
  const before = await nodePosition(page, KEY.more);
  await node(page, KEY.more).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await nodePosition(page, KEY.more)).x)
    .toBeGreaterThan(before.x);
  const moved = await nodePosition(page, KEY.more);
  await expect
    .poll(async () => (await readSidecar(page))?.nodes[KEY.more])
    .toEqual(moved);
});

test("F-207 step 3 ADR-0008 AR-11: renaming a process through the app keeps its node's position, and every other node's, across a reload", async ({
  page,
}) => {
  await openStoredProject(page);
  await waitSaved(page);
  // COUNT is dragged to a spot ELK would not choose, so TALLY can only land there through the carry
  const placed = await nodePosition(page, KEY.count);
  await dragNode(page, KEY.count, 80, 90);
  await expect
    .poll(async () => (await nodePosition(page, KEY.count)).x)
    .not.toBe(placed.x);
  const dragged = await nodePosition(page, KEY.count);
  expect(dragged).not.toEqual(placed);
  await expect
    .poll(async () => (await readSidecar(page))?.nodes[KEY.count])
    .toEqual(dragged);
  await waitSaved(page);
  const before: Record<string, { x: number; y: number }> = {};
  for (const id of ALL_KEYS) before[id] = await nodePosition(page, id);
  expect(before[KEY.count]).toEqual(dragged);
  const outcome = await page.evaluate(() =>
    (
      window as unknown as {
        nfBuilderWorkspace: {
          apply(command: unknown): Promise<{ ok: boolean }>;
        };
      }
    ).nfBuilderWorkspace.apply({
      kind: "renameDeclaration",
      path: "modules/local/count/main.nf",
      name: "COUNT",
      newName: "TALLY",
    }),
  );
  expect(outcome.ok).toBe(true);
  await expect(node(page, KEY.tally)).toBeVisible();
  const check = async () => {
    expect(await nodePosition(page, KEY.tally)).toEqual(before[KEY.count]);
    for (const id of ALL_KEYS.filter((k) => k !== KEY.count))
      expect(await nodePosition(page, id)).toEqual(before[id]);
  };
  await check();
  await waitSaved(page);
  await expect
    .poll(async () => Object.keys((await readSidecar(page))?.nodes ?? {}))
    .not.toContain(KEY.count);
  expect((await readSidecar(page))?.nodes[KEY.tally]).toEqual(
    before[KEY.count],
  );
  await page.reload();
  await canvasReady(page);
  await check();
});

test("F-207 ADR-0008: with a partial sidecar, stored nodes keep their positions and only the others are placed, without overlap", async ({
  page,
}) => {
  const stored = {
    [KEY.reads]: { x: 500, y: 300 },
    [KEY.count]: { x: 900, y: 40 },
  };
  await openStoredProject(page, [
    {
      path: SIDECAR,
      text: `${JSON.stringify({ version: 1, nodes: stored }, null, 2)}\n`,
    },
  ]);
  expect(await nodePosition(page, KEY.reads)).toEqual(stored[KEY.reads]);
  expect(await nodePosition(page, KEY.count)).toEqual(stored[KEY.count]);
  expect(overlaps(await nodeBoxes(page))).toEqual([]);
  // the header already says Saved for the file as opened, so wait for the placement itself
  await expect
    .poll(async () =>
      Object.keys((await readSidecar(page))?.nodes ?? {}).sort(),
    )
    .toEqual([...ALL_KEYS].sort());
  await waitSaved(page);
  const sidecar = await readSidecar(page);
  expect(sidecar?.nodes[KEY.reads]).toEqual(stored[KEY.reads]);
  expect(sidecar?.nodes[KEY.count]).toEqual(stored[KEY.count]);
});

test("F-207 UX-26: Auto-layout all nodes puts a moved node back at its ELK position and saves it", async ({
  page,
}) => {
  await openStoredProject(page);
  const placed = await nodePosition(page, KEY.reads);
  await dragNode(page, KEY.reads, 40, 120);
  expect(await nodePosition(page, KEY.reads)).not.toEqual(placed);
  await page.getByRole("button", { name: "Auto-layout all nodes" }).click();
  await expect.poll(() => nodePosition(page, KEY.reads)).toEqual(placed);
  await waitSaved(page);
  await expect
    .poll(async () => (await readSidecar(page))?.nodes[KEY.reads])
    .toEqual(placed);
  expect(overlaps(await nodeBoxes(page))).toEqual([]);
});

test("F-207 IO-02: an unreadable sidecar shows the notice and is replaced", async ({
  page,
}) => {
  await openStoredProject(page, [{ path: SIDECAR, text: "{ not json" }]);
  await expect(notices(page)).toContainText("The layout file couldn't be read");
  expect(overlaps(await nodeBoxes(page))).toEqual([]);
  await expect
    .poll(
      async () => Object.keys((await readSidecar(page))?.nodes ?? {}).length,
    )
    .toBe(ALL_KEYS.length);
  await waitSaved(page);
  // the notice stays for the session, so the replacement isn't a surprise, but it now says what happened
  await expect(notices(page)).toContainText(
    "The layout file couldn't be read and was replaced.",
  );
  await expect(notices(page)).not.toContainText("will be replaced");
});

test("F-207 QA-11 UX-30: a node's description says to select it with enter or space and then move it with the arrow keys", async ({
  page,
}) => {
  await openStoredProject(page);
  const descriptions = page.locator('[id^="react-flow__node-desc-"]');
  await expect(descriptions).toHaveText(
    "Press enter or space to select this node, then use the arrow keys to move it.",
  );
});

test("F-207 IO-02: entries of the sidecar that can't be read are dropped with a notice", async ({
  page,
}) => {
  const stored = {
    [KEY.reads]: { x: 500, y: 300 },
    "not a node key": { x: 1, y: 1 },
  };
  await openStoredProject(page, [
    {
      path: SIDECAR,
      text: `${JSON.stringify({ version: 1, nodes: stored }, null, 2)}\n`,
    },
  ]);
  await expect(notices(page)).toContainText(
    "1 layout entry couldn't be read and was dropped.",
  );
  expect(await nodePosition(page, KEY.reads)).toEqual(stored[KEY.reads]);
});

const ELK_WORKER = /elk-worker/;

test("F-207 ADR-0008 UX-26 ADR-0003: no ELK worker is requested while every node has a position; an edit that adds a node keeps the placed nodes on screen and shows that it is laying out until ELK answers", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (ELK_WORKER.test(r.url())) requests.push(r.url());
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // the worker's script is held back, so ELK can't answer until the test lets it
  await page.route(ELK_WORKER, async (route) => {
    await gate;
    await route.continue();
  });
  const stored = Object.fromEntries(
    ALL_KEYS.map((key, i) => [key, { x: 60 + i * 330, y: 40 + (i % 2) * 170 }]),
  );
  await openStoredProject(page, [
    {
      path: SIDECAR,
      text: `${JSON.stringify({ version: 1, nodes: stored }, null, 2)}\n`,
    },
  ]);
  expect(requests).toEqual([]);
  const added = "main.nf#/ALIGN@1";
  const outcome = await page.evaluate(() =>
    (
      window as unknown as {
        nfBuilderWorkspace: {
          apply(command: unknown): Promise<{ ok: boolean }>;
        };
      }
    ).nfBuilderWorkspace.apply({
      kind: "addCall",
      target: { path: "main.nf", workflow: null },
      callee: "ALIGN",
    }),
  );
  expect(outcome.ok).toBe(true);
  await expect(notices(page)).toContainText("Laying out nodes…");
  for (const id of ALL_KEYS) {
    await expect(node(page, id)).toBeVisible();
    expect(await nodePosition(page, id)).toEqual(stored[id]);
  }
  await expect(node(page, added)).toHaveCount(0);
  release();
  await expect(node(page, added)).toBeVisible();
  await expect(notices(page)).not.toContainText("Laying out nodes…");
  for (const id of ALL_KEYS)
    expect(await nodePosition(page, id)).toEqual(stored[id]);
  expect(overlaps(await nodeBoxes(page))).toEqual([]);
  expect(requests).toHaveLength(1);
  await expect
    .poll(async () => Object.keys((await readSidecar(page))?.nodes ?? {}))
    .toContain(added);
});

test("F-207 ADR-0008: when ELK doesn't answer within 30 s the nodes fall back to columns with a notice and nothing is saved, and the next layout starts a fresh worker", async ({
  page,
}) => {
  // the 30 s limit runs as 2 s
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
      original(fn, ms === 30_000 ? 2000 : ms, ...args)) as typeof setTimeout;
  });
  let stall = true;
  let requests = 0;
  await page.route(ELK_WORKER, async (route) => {
    requests += 1;
    if (stall)
      await route.fulfill({
        contentType: "text/javascript",
        body: "self.onmessage = () => {};",
      });
    else await route.continue();
  });
  // no sidecar: the first open waits for ELK, then gives up
  await openStoredProject(page);
  await expect(notices(page)).toContainText("Automatic layout isn't available");
  await expect(notices(page)).toContainText("30 seconds");
  const boxes = await nodeBoxes(page);
  expect(boxes.map((b) => b.id).sort()).toEqual([...ALL_KEYS].sort());
  expect(overlaps(boxes)).toEqual([]);
  expect(await readSidecar(page)).toBeNull();
  expect(requests).toBe(1);
  stall = false;
  await page.getByRole("button", { name: "Auto-layout all nodes" }).click();
  await expect
    .poll(
      async () => Object.keys((await readSidecar(page))?.nodes ?? {}).length,
    )
    .toBe(ALL_KEYS.length);
  expect(requests).toBe(2);
  await expect(notices(page)).not.toContainText("isn't available");
});

interface Projection {
  edges: { from: { node: string }; to: { node: string } }[];
}

// Strings that survive minification: the elk-api constructor's error, and the ELK Graph namespace the worker registers.
const ELK_MARKERS = [
  "Cannot construct an ELK without both",
  "http://www.eclipse.org/elk/ElkGraph",
];

test("F-207 QA-01 ADR-0003: ELK is only in a worker asset, not in the initial JavaScript", () => {
  const manifest = JSON.parse(
    readFileSync(join(WEB_DIST, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const html = readFileSync(join(WEB_DIST, "index.html"), "utf8");
  const initial = initialJsFiles(manifest, html, E2E_BASE_PATH);
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial) {
    const text = readFileSync(join(WEB_DIST, file), "utf8");
    for (const marker of ELK_MARKERS)
      expect(text.includes(marker), `${file} holds ELK (${marker})`).toBe(
        false,
      );
  }
  // ELK's worker is one emitted asset, never a chunk of the Vite graph that the page loads at start
  const holders = readdirSync(join(WEB_DIST, "assets"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) =>
      readFileSync(join(WEB_DIST, "assets", f), "utf8").includes(
        ELK_MARKERS[1] as string,
      ),
    );
  // present, too: the worker asset exists once `elk-client` is wired in
  expect(holders).toHaveLength(1);
  for (const f of holders) expect(initial).not.toContain(`assets/${f}`);
});
