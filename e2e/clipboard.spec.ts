import { expect, type Page, test } from "@playwright/test";
import {
  canvasReady,
  clickEmptyCanvas,
  layoutSettled,
  node,
  selectNode,
} from "./canvas.ts";
import {
  F310_DELETE_MULTI,
  F310_DELETE_START,
  F310_SOURCE,
  F310_TARGET,
  MAKE,
  marquee,
  pressCopy,
  pressPaste,
  SIZE,
  STAMP,
  selectedNodes,
  shiftClick,
} from "./clipboard.ts";
import { readProject } from "./engine.ts";
import {
  currentFiles,
  historyStatus,
  openStoredFixture,
  pressUndo,
  storedFiles,
} from "./history.ts";
import { dragNode, waitSaved } from "./layout.ts";
import { createProjectInUi, readFile, switcher } from "./projects.ts";
import { PREVIEW_URL } from "./urls.ts";

const tree = (dir: string): Record<string, string> =>
  Object.fromEntries(readProject(dir).map((f) => [f.path, f.text]));
const withoutSidecar = (files: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(files).filter(([path]) => !path.startsWith(".nf-builder/")),
  );
const SIDECAR = ".nf-builder/layout.json";
const BARE_MAKE = "main.nf#/MAKE@1";

/** Every file of the open project, read from the engine (the store holds every project's files, so it can't be compared). */
async function engineTree(page: Page): Promise<Record<string, string>> {
  const paths = await page.evaluate(async () => {
    const engine = (
      window as unknown as {
        nfBuilderEngine: {
          listFiles(): Promise<{ files: { path: string }[] }>;
        };
      }
    ).nfBuilderEngine;
    return (await engine.listFiles()).files.map((f) => f.path);
  });
  const out: Record<string, string> = {};
  for (const path of paths.sort()) {
    const text = await readFile(page, path);
    if (text !== null) out[path] = text;
  }
  return out;
}

/** Waits until the engine's history shows `n` undo steps. */
const undoCountIs = (page: Page, n: number) =>
  expect.poll(async () => (await historyStatus(page)).undoCount).toBe(n);

test("F-310 step 1 UX-26: copy two connected processes to another project: both module files and the connection come across, and one undo restores the target", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "Source", F310_SOURCE);
  await selectNode(page, MAKE);
  await shiftClick(page, SIZE);
  expect(await selectedNodes(page)).toEqual([MAKE, SIZE].sort());
  await pressCopy(page);
  await expect(page.locator("[data-clipboard-notice]")).toHaveText(
    "Copied 2 nodes.",
  );
  await createProjectInUi(page, "Target");
  await canvasReady(page);
  await layoutSettled(page);
  const before = await engineTree(page);
  await clickEmptyCanvas(page);
  await pressPaste(page);
  await expect(page.locator("[data-clipboard-notice]")).toHaveText(
    "Pasted 2 nodes and 1 connection.",
  );
  await undoCountIs(page, 1);
  await expect
    .poll(async () => withoutSidecar(await engineTree(page)))
    .toEqual(tree(F310_TARGET));
  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await pressUndo(page);
  await undoCountIs(page, 0);
  await expect(nodes).toHaveCount(1);
  expect(await engineTree(page)).toEqual(before);
});

test("F-310 F-111 ADR-0039: pasting a process into the workflow that calls it offers MAKE as MAKE_2; Cancel changes nothing, Paste adds the include and the call", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "Alias", F310_SOURCE);
  const start = await readFile(page, "main.nf");
  await selectNode(page, MAKE);
  await pressCopy(page);
  await expect(page.locator("[data-clipboard-notice]")).toHaveText(
    "Copied 1 node.",
  );
  await pressPaste(page);
  const dialog = page.getByRole("dialog", { name: "Paste with new names?" });
  await expect(dialog).toContainText(
    "MAKE is already called in this workflow. It will be included again as MAKE_2.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await readFile(page, "main.nf")).toBe(start);
  await undoCountIs(page, 0);
  await pressPaste(page);
  await dialog.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => readFile(page, "main.nf"))
    .toContain("include { MAKE as MAKE_2 }");
  expect(await readFile(page, "main.nf")).toContain("MAKE_2()");
  await undoCountIs(page, 1);
});

test("F-310 step 2 UX-26 AR-23: delete a multi-selection: one undo step restores all", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "Delete", F310_DELETE_START);
  const boxOf = async (id: string) => {
    const box = await node(page, id).boundingBox();
    if (box === null) throw new Error(`${id} is not on screen`);
    return box;
  };
  // put STAMP in SIZE's row, to its right, so a rectangle round the pair never reaches MAKE (which feeds SIZE from the left)
  const [size0, stamp0] = [await boxOf(SIZE), await boxOf(STAMP)];
  await dragNode(
    page,
    STAMP,
    size0.x + size0.width + 60 - stamp0.x,
    size0.y - stamp0.y,
  );
  await waitSaved(page);
  const before = await storedFiles(page);
  expect(before[SIDECAR]).toBeTruthy();
  const [size, stamp, make] = [
    await boxOf(SIZE),
    await boxOf(STAMP),
    await boxOf(MAKE),
  ];
  // a Shift-drag marquee over SIZE and STAMP; MAKE stays out of it
  const left = Math.min(size.x, stamp.x) - 6;
  const top = Math.min(size.y, stamp.y) - 6;
  const right = Math.max(size.x + size.width, stamp.x + stamp.width) + 6;
  const bottom = Math.max(size.y + size.height, stamp.y + stamp.height) + 6;
  expect(make.x + make.width).toBeLessThan(left);
  await marquee(page, { x: left, y: top }, { x: right, y: bottom });
  expect(await selectedNodes(page)).toEqual([SIZE, STAMP].sort());
  await expect(page.locator(".details-name")).toHaveText("2 nodes selected");
  await page.keyboard.press("Delete");
  await expect(node(page, SIZE)).toHaveCount(0);
  await expect(node(page, STAMP)).toHaveCount(0);
  // `make = MAKE()` is a bare call once nothing reads `make`
  await expect(node(page, BARE_MAKE)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveAttribute(
    "title",
    /Undo: Delete 2 nodes/,
  );
  await undoCountIs(page, 1);
  // the project also holds the blank template's files, which the fixture doesn't
  const expected = tree(F310_DELETE_MULTI);
  const now = await currentFiles(page);
  expect(
    Object.fromEntries(Object.keys(expected).map((p) => [p, now[p]])),
  ).toEqual(expected);
  await pressUndo(page);
  await undoCountIs(page, 0);
  await expect(node(page, SIZE)).toHaveCount(1);
  await expect(node(page, STAMP)).toHaveCount(1);
  await expect(node(page, MAKE)).toHaveCount(1);
  expect(await storedFiles(page)).toEqual(before);
});

test("F-310 ADR-0056 UX-04: read-only: Delete and paste keys change nothing, copy works, and no new control is visible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "Read only", F310_DELETE_START);
  await selectNode(page, SIZE);
  await shiftClick(page, STAMP);
  await pressCopy(page);
  await expect(page.locator("[data-clipboard-notice]")).toHaveText(
    "Copied 2 nodes.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const start = await readFile(page, "main.nf");
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);
  await page.keyboard.press("Delete");
  await pressPaste(page);
  await expect(node(page, SIZE)).toHaveCount(1);
  expect(await readFile(page, "main.nf")).toBe(start);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await undoCountIs(page, 0);
});

test("F-310 ADR-0056 UX-04: copying while read-only still fills the clipboard, and pasting after widening works", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "Copy read only", F310_DELETE_START);
  const wide = page.viewportSize();
  if (wide === null) throw new Error("no viewport");
  await selectNode(page, SIZE);
  await shiftClick(page, STAMP);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await pressCopy(page);
  await expect(page.locator("[data-clipboard-notice]")).toHaveText(
    "Copied 2 nodes.",
  );
  await page.setViewportSize(wide);
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(1);
  await pressPaste(page);
  const dialog = page.getByRole("dialog", { name: "Paste with new names?" });
  await dialog.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => readFile(page, "main.nf")).toContain("SIZE_2(");
  await undoCountIs(page, 1);
});

test("F-310 ADR-0044 UX-26: copy and paste work in a cross-origin iframe without clipboard permissions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="1200" height="800"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  await expect(switcher(frame)).toBeEnabled();
  const appFrame = page.frames().find((f) => f.url() === PREVIEW_URL);
  if (appFrame === undefined) throw new Error("the app frame isn't there");
  const make = (name: string, files: { path: string; text: string }[]) =>
    appFrame.evaluate(
      async ({ name, files }) => {
        const engine = (
          window as unknown as {
            nfBuilderEngine: {
              createProject(input: {
                name: string;
                languageVersion: string;
                files: { path: string; text: string }[];
              }): Promise<unknown>;
            };
          }
        ).nfBuilderEngine;
        await engine.createProject({ name, languageVersion: "26.10", files });
      },
      { name, files },
    );
  // the target first: the app reopens the newest project after the reload
  await make("Framed target", [
    {
      path: "main.nf",
      text: "nextflow.enable.types = true\n\nworkflow {\n}\n",
    },
  ]);
  await make("Framed source", readProject(F310_SOURCE));
  await appFrame.evaluate(() => window.location.reload());
  await expect(switcher(frame)).toHaveText(/Framed source/);
  const nodeIn = (id: string) =>
    frame.locator(`.react-flow__node[data-id="${id}"]`);
  await nodeIn(MAKE).locator(".canvas-node-title").first().click();
  await nodeIn(SIZE)
    .locator(".canvas-node-title")
    .first()
    .click({ modifiers: ["Shift"] });
  await pressCopy(page);
  await expect(frame.locator("[data-clipboard-notice]")).toHaveText(
    "Copied 2 nodes.",
  );
  await switcher(frame).click();
  await frame.getByRole("button", { name: "Framed target" }).last().click();
  await expect(switcher(frame)).toHaveText(/Framed target/);
  await frame.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
  await pressPaste(page);
  await expect(frame.locator("[data-clipboard-notice]")).toHaveText(
    "Pasted 2 nodes and 1 connection.",
  );
  const main = await appFrame.evaluate(() =>
    (
      window as unknown as {
        nfBuilderEngine: { readFile(path: string): Promise<string | null> };
      }
    ).nfBuilderEngine.readFile("main.nf"),
  );
  expect(main).toContain("SIZE(make)");
});
