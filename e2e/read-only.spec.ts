import { expect, test } from "@playwright/test";
import { SMOKE_TAG, VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  clickEmptyCanvas,
  expectBaseline,
  layoutSettled,
  NODE,
  node,
  selectNode,
} from "./canvas.ts";
import { editor, radio, syncStatus } from "./code-view.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  applyThroughStore,
  historyStatus,
  openStoredFixture,
  typeComment,
} from "./history.ts";
import {
  dragNode,
  nodePosition,
  readSidecar,
  SIDECAR,
  waitSaved,
} from "./layout.ts";
import {
  openProblemsFixture,
  problemRow,
  problemsPanel,
  problemsReady,
  statusCount,
} from "./problems.ts";
import { readFile, switcher } from "./projects.ts";
import {
  applyOutcome,
  horizontalOverflow,
  NARROW,
  NOTE_TEXT,
  openStoredCanvas,
  PHONE,
  READ_ONLY_ALLOWED,
  readOnlyNote,
  resize,
  storeCanvasProject,
  visibleControls,
  WIDE,
} from "./read-only.ts";
import { PREVIEW_URL } from "./urls.ts";

const palette = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Components and files" });
const details = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Details" });

test("F-703 UX-04: at 390 px the app starts read-only with the note and without the palette or project actions", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.setViewportSize(PHONE);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator('[role="separator"]')).toHaveCount(0);
  await expect(page.getByLabel("Nextflow version")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Templates" })).toHaveCount(0);
  await expect(details(page)).toBeVisible();
  await switcher(page).click();
  await expect(page.getByText("No projects in this browser.")).toBeVisible();
  await expect(page.getByRole("button", { name: /New project/ })).toHaveCount(
    0,
  );
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-703 UX-04: the switch is at 1024 px, and canvas and details stack below 640 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(readOnlyNote(page)).toHaveCount(0);
  await expect(palette(page)).toBeVisible();

  await resize(page, { width: 1023, height: 768 });
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await expect(palette(page)).toHaveCount(0);
  const main = page.getByRole("main", { name: "Canvas and editor" });
  const sideBySide = async () => {
    const a = await main.boundingBox();
    const b = await details(page).boundingBox();
    if (a === null || b === null) throw new Error("no boxes");
    return { a, b };
  };
  let { a, b } = await sideBySide();
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  expect(Math.abs(b.y - a.y)).toBeLessThan(2);

  await resize(page, { width: 640, height: 768 });
  ({ a, b } = await sideBySide());
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);

  await resize(page, { width: 639, height: 768 });
  ({ a, b } = await sideBySide());
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(Math.abs(b.x - a.x)).toBeLessThan(2);
  expect(await horizontalOverflow(page)).toBe(0);

  await resize(page, { width: 1024, height: 768 });
  await expect(readOnlyNote(page)).toHaveCount(0);
  await expect(palette(page)).toBeVisible();
});

test("F-703 UX-04 QA-10: a crossing moves lost focus to the note, and nothing scrolls sideways at 320 px", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // the browser refuses persistent storage, so the header shows its note
    Object.defineProperty(navigator.storage, "persisted", {
      value: async () => false,
      configurable: true,
    });
    Object.defineProperty(navigator.storage, "persist", {
      value: async () => false,
      configurable: true,
    });
  });
  await openStoredCanvas(
    page,
    "A project with a rather long name of 40 characters",
  );
  await expect(page.locator(".storage-note")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search components" }).focus();
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toBeFocused();

  for (const width of [320, 390, 639]) {
    await resize(page, { width, height: 640 });
    expect(await horizontalOverflow(page), `${width} px`).toBe(0);
  }
  await resize(page, WIDE);
  await expect(readOnlyNote(page)).toHaveCount(0);
});

test("F-703 UX-04: narrow windows keep the side-by-side layout at 1000 px", async ({
  page,
}) => {
  await page.setViewportSize(NARROW);
  await page.goto("./");
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  expect(await horizontalOverflow(page)).toBe(0);
});

test("F-703 UX-04: entering read-only closes an open dialog and leaves only the project list in the switcher", async ({
  page,
}) => {
  await openStoredCanvas(page, "Dialog project");
  await page.getByRole("button", { name: "Templates" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await switcher(page).click();
  await expect(
    page.locator(".project-panel").getByRole("button", {
      name: "Dialog project",
    }),
  ).toBeVisible();
  for (const gone of ["New project", "Rename project", "Delete project"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  // the details header has no Edit or Code buttons even with a node selected
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fit view" }).click();
  await selectNode(page, NODE.greeted);
  await expect(
    details(page).getByRole("button", { name: /^(Edit|Code)$/ }),
  ).toHaveCount(0);
});

test("F-703 step 1 UX-04: at 390 px wide a stored project shows its canvas and details, no editing controls, and the note", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await openStoredCanvas(page, "Phone project");
  await resize(page, PHONE);
  await page.reload();
  await canvasReady(page);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  const canvas = page.locator('.workflow-canvas[data-canvas-state="ready"]');
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(300);
  expect(box?.height).toBeGreaterThanOrEqual(300);
  await expect(page.locator(".react-flow__node")).toHaveCount(12);
  const side = await details(page).boundingBox();
  expect(side?.y).toBeGreaterThanOrEqual(
    (box?.y ?? 0) + (box?.height ?? 0) - 1,
  );
  await expect(details(page)).toContainText("Entry workflow");
  await selectNode(page, NODE.greeted);
  await expect(details(page)).toContainText("GREET");

  const controls = await visibleControls(page);
  const unexpected = controls.filter(
    (c) => !READ_ONLY_ALLOWED.some((allowed) => allowed.test(c)),
  );
  expect(unexpected).toEqual([]);
  for (const gone of [
    "#column-left",
    '[role="separator"]',
    'select[aria-label="Nextflow version"]',
    '[role="radiogroup"]',
    ".react-flow__minimap",
    ".react-flow__node.draggable",
  ])
    await expect(page.locator(gone)).toHaveCount(0);
  for (const name of [
    "Undo",
    "Redo",
    "Auto-layout all nodes",
    "Auto-layout selected nodes",
    "Edit",
    "Code",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-703 UX-04 AR-23 AR-24: read-only, commands, undo, redo, drags and shortcuts change nothing", async ({
  page,
}) => {
  await openStoredFixture(page, "Blocked");
  await applyThroughStore(page, {
    kind: "addCall",
    target: { path: "main.nf", workflow: null },
    callee: "ALIGN",
  });
  await expect.poll(async () => (await historyStatus(page)).undoCount).toBe(1);
  await waitSaved(page);
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  const outcome = await applyOutcome(page, {
    kind: "replaceFileText",
    path: "main.nf",
    text: "// nope\n",
  });
  expect(outcome.ok).toBe(false);
  expect(outcome.code).toBe("read-only");

  const main = await readFile(page, "main.nf");
  const sidecar = await readFile(page, SIDECAR);
  const history = await historyStatus(page);
  await page.getByRole("button", { name: "Fit view" }).click();
  const first = page.locator(".react-flow__node").first();
  const id = (await first.getAttribute("data-id")) ?? "";
  const before = await nodePosition(page, id);
  await clickEmptyCanvas(page);
  for (const key of [
    "ControlOrMeta+z",
    "ControlOrMeta+Shift+z",
    "Control+y",
    "g",
    "s",
    "c",
    "Delete",
  ])
    await page.keyboard.press(key);
  await first.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await dragNode(page, id, 40, 30);
  await expect(page.locator(".tab-panel")).toHaveAttribute(
    "data-view-mode",
    "graph",
  );
  expect(await nodePosition(page, id)).toEqual(before);
  expect(await readFile(page, "main.nf")).toBe(main);
  expect(await readFile(page, SIDECAR)).toBe(sidecar);
  expect(await historyStatus(page)).toEqual(history);
});

test("F-703 UX-04 F-207: viewing a project without a sidecar at 390 px lays it out without writing the sidecar", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  // stored through the raw engine hook, which no viewport guards: a project that never had a sidecar
  await storeCanvasProject(page, "No sidecar", "26.10");
  await canvasReady(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(12);
  expect(await readSidecar(page)).toBeNull();
  expect(await waitSaved(page)).toBeNull();
});

test("F-703 UX-04 ADR-0004 ADR-0048: narrowing during a code edit sends it first, and widening brings back the Split view and the editing controls", async ({
  page,
}) => {
  await openStoredFixture(page, "Transition");
  await radio(page, "Split").click();
  await typeComment(page, "// typed just before narrowing");
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  expect(await readFile(page, "main.nf")).toContain(
    "// typed just before narrowing",
  );
  await expect(editor(page)).toHaveCount(0);
  await resize(page, WIDE);
  await expect(readOnlyNote(page)).toHaveCount(0);
  await expect(radio(page, "Split")).toBeChecked();
  await expect(editor(page)).toContainText("typed just before narrowing");
  await expect(
    page.getByRole("complementary", { name: "Components and files" }),
  ).toBeVisible();
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute("title", /Edit main\.nf/);
});

test("F-703 UX-04 ADR-0044: inside a 390 px cross-origin iframe the app is read-only", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="390" height="800"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  await expect(frame.locator(".read-only-note p")).toHaveText(NOTE_TEXT);
  await expect(
    frame.getByRole("complementary", { name: "Components and files" }),
  ).toHaveCount(0);
  await expect(switcher(frame)).toBeEnabled();
  expect(await watch.violations()).toEqual([]);
});

test.describe("touch", () => {
  test.use({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  test("F-703 UX-04: on a touch phone a tap selects a node and shows its details", async ({
    page,
  }) => {
    await page.goto("./");
    await expect(switcher(page)).toBeEnabled();
    await storeCanvasProject(page, "Touch project", "26.10");
    await canvasReady(page);
    await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    await node(page, NODE.greeted).locator(".canvas-node-title").first().tap();
    await expect(details(page)).toContainText("GREET");
  });
});

test("F-703 UX-04 F-309: read-only, the problems panel lists problems with go buttons and no quick-fix buttons", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await expect(problemsReady(page)).toBeVisible();
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await statusCount(page, "problems").click();
  await expect(problemsPanel(page)).toBeVisible();
  await expect(problemRow(page, "deprecated-channel")).toHaveCount(1);
  await expect(page.locator(".problem-fix")).toHaveCount(0);
  await expect(page.locator(".problem-go").first()).toBeVisible();
  const unexpected = (await visibleControls(page)).filter(
    (c) => !READ_ONLY_ALLOWED.some((allowed) => allowed.test(c)),
  );
  expect(unexpected).toEqual([]);
  expect(await horizontalOverflow(page)).toBe(0);
});

test("F-703 UX-04 UX-20 F-309: read-only, a problem in a file without a workflow opens its tab with a note, not the code view or the canvas", async ({
  page,
}) => {
  await page.goto("./");
  await openProblemsFixture(page);
  await expect(problemsReady(page)).toBeVisible();
  await resize(page, PHONE);
  await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
  await statusCount(page, "suggestions").click();
  await problemRow(page, "legacy-process").locator(".problem-go").click();
  await expect(
    page.getByRole("tab", { name: "legacy_count/main.nf" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".read-only-file-note")).toHaveText(
    "This file opens in the code view on screens 1024 px or wider.",
  );
  await expect(page.locator(".workflow-canvas")).toHaveCount(0);
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(page.getByText("No workflow open")).toHaveCount(0);
});

test(
  "F-703 UX-04: the read-only views at 390 and 1000 px match their approved baselines @visual",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    await openStoredCanvas(page, "Visual project");
    for (const [name, size] of [
      ["read-only-phone.png", PHONE],
      ["read-only-narrow.png", NARROW],
    ] as const) {
      await resize(page, size);
      await expect(readOnlyNote(page)).toHaveText(NOTE_TEXT);
      await canvasReady(page);
      await layoutSettled(page);
      await expectBaseline(page, testInfo, name, {
        target: page.locator(".app-shell"),
      });
    }
  },
);
