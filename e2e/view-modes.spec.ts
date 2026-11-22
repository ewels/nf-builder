import { expect, type Locator, type Page, test } from "@playwright/test";
import { VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  expectBaseline,
  layoutSettled,
  openFixture,
  openProject,
  openWorkflow,
} from "./canvas.ts";
import {
  appendToLine,
  canvasIds,
  editor,
  F208_AFTER,
  F208_BEFORE,
  fileText,
  GREETED_LINE,
  insertAfterLine,
  lineNumberOf,
  openCodeFixture,
} from "./code-view.ts";
import {
  createProjectInUi,
  readFile,
  saveState,
  switcher,
  type WorkspaceHook,
} from "./projects.ts";

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

const syncStatus = (page: Page) => page.locator(".code-pane-status");

async function openSplit(page: Page): Promise<void> {
  await page.goto("./");
  await openCodeFixture(page);
  await canvasReady(page);
  await radio(page, "Split").click();
  await expect(editor(page)).toBeVisible();
}

test("F-208 UX-70 QA-11: G, S and C typed into the code editor are text, not shortcuts", async ({
  page,
}) => {
  await openSplit(page);
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("gsc");
  await expect(editor(page)).toContainText("gsc");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
});

test("F-208 UX-70 QA-11: a letter pressed with the editor's context menu open does not switch the mode", async ({
  page,
}) => {
  await openSplit(page);
  await page.locator(".monaco-editor .view-lines").click({ button: "right" });
  await expect(page.locator(".context-view")).toBeVisible();
  await page.keyboard.press("g");
  await expect(mode(page)).toHaveAttribute("data-view-mode", "split");
});

test("F-208 step 2 UX-27: in Split mode a valid edit updates the graph", async ({
  page,
}) => {
  await openSplit(page);
  const before = await canvasIds(page);
  const line = lineNumberOf(F208_BEFORE, GREETED_LINE);
  await insertAfterLine(page, line, "shouted = SHOUT(greeted)");
  await expect(page.locator(".react-flow__node")).toHaveCount(
    before.length + 1,
  );
  const added = (await canvasIds(page)).filter((id) => !before.includes(id));
  expect(added).toEqual(["main.nf#/shouted"]);
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await expect(page.getByRole("contentinfo")).toContainText(
    `${before.length + 1} nodes`,
  );
  expect(await readFile(page, "main.nf")).toBe(fileText(F208_AFTER));
});

test("F-208 step 2 AR-24 ADR-0039: an invalid edit shows a diagnostic and leaves the graph unchanged", async ({
  page,
}) => {
  await openSplit(page);
  const ids = await canvasIds(page);
  const original = fileText(F208_BEFORE);
  const line = lineNumberOf(F208_BEFORE, GREETED_LINE);
  await appendToLine(page, line, " )");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "refused");
  await expect(syncStatus(page)).toContainText("Not applied");
  await expect(syncStatus(page)).toContainText(
    "The graph shows the last version that parsed.",
  );
  await expect(page.locator(".squiggly-error").first()).toBeVisible();
  expect(await canvasIds(page)).toEqual(ids);
  expect(await readFile(page, "main.nf")).toBe(original);
  // removing the token makes the text parse again, and the diagnostic goes
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await expect(page.locator(".squiggly-error")).toHaveCount(0);
  expect(await canvasIds(page)).toEqual(ids);
});

test("F-208 UX-27: an engine-side change to the file updates an editor with no pending edit", async ({
  page,
}) => {
  await openSplit(page);
  await expect(editor(page)).not.toContainText("SHOUT(greeted)");
  await page.evaluate(async (text) => {
    const hook = (
      window as unknown as {
        nfBuilderWorkspace: {
          apply(command: unknown): Promise<{ ok: boolean }>;
        };
      }
    ).nfBuilderWorkspace;
    const outcome = await hook.apply({
      kind: "replaceFileText",
      path: "main.nf",
      text,
    });
    if (!outcome.ok) throw new Error("the change was refused");
  }, fileText(F208_AFTER));
  // Monaco draws only the lines in view, so scroll to the end of the file
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(editor(page)).toContainText("SHOUT(greeted)");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
});

test("F-208 IO-01: a Code view edit survives a reload", async ({ page }) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Code edit");
  await page.evaluate(async (text) => {
    const engine = (window as unknown as { nfBuilderEngine: WorkspaceHook })
      .nfBuilderEngine;
    await engine.writeFiles([{ path: "main.nf", text }]);
  }, fileText(F208_BEFORE));
  await canvasReady(page);
  await radio(page, "Code").click();
  await expect(editor(page)).toBeVisible();
  const line = lineNumberOf(F208_BEFORE, GREETED_LINE);
  await insertAfterLine(page, line, "shouted = SHOUT(greeted)");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await expect(saveState(page)).toHaveText("Saved");
  await page.reload();
  await canvasReady(page);
  await expect.poll(() => readFile(page, "main.nf")).toBe(fileText(F208_AFTER));
});

test("F-208 UX-27 ADR-0003: Nextflow highlighting gives a keyword and an identifier different token classes", async ({
  page,
}) => {
  await openSplit(page);
  const tokenClass = async (text: string) =>
    page
      .locator(".monaco-editor .view-line span[class^='mtk']")
      .filter({ hasText: new RegExp(`^${text}$`) })
      .first()
      .getAttribute("class");
  await expect(
    page.locator(".monaco-editor .view-line span[class^='mtk']").first(),
  ).toBeVisible();
  const keyword = await tokenClass("process");
  const identifier = await tokenClass("name");
  expect(keyword).not.toBeNull();
  expect(identifier).not.toBeNull();
  expect(keyword).not.toBe(identifier);
});

test("F-208 ADR-0004 IO-01: a draft in one project never reaches another project's file", async ({
  page,
}) => {
  const a = fileText(F208_BEFORE);
  const b = a.replace("'ada', 'grace'", "'bob', 'carol'");
  expect(b).not.toBe(a);
  const write = (text: string) =>
    page.evaluate(async (t) => {
      const engine = (window as unknown as { nfBuilderEngine: WorkspaceHook })
        .nfBuilderEngine;
      await engine.writeFiles([{ path: "main.nf", text: t }]);
    }, text);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Project A");
  await write(a);
  await canvasReady(page);
  await radio(page, "Code").click();
  await expect(editor(page)).toBeVisible();
  await appendToLine(page, lineNumberOf(F208_BEFORE, GREETED_LINE), " )");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "refused");

  await openProject(page, [{ path: "main.nf", text: b }]);
  await canvasReady(page);
  await radio(page, "Code").click();
  await expect(editor(page)).toBeVisible();
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(editor(page)).toContainText("'bob', 'carol'");
  // undo does not bring back A's draft, and an ordinary edit keeps B's own text
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("// edited in project B");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await expect
    .poll(() => readFile(page, "main.nf"))
    .toBe(`${b}\n// edited in project B`);
});

test("F-208 UX-27: the sync status of one file's code does not carry over to another tab", async ({
  page,
}) => {
  await page.goto("./");
  await openFixture(page);
  await canvasReady(page);
  await openWorkflow(page, "workflows.nf", "SHOUT");
  await canvasReady(page);
  await radio(page, "Code").click();
  await expect(editor(page)).toBeVisible();
  await page.getByRole("tab", { name: "main.nf" }).click();
  await radio(page, "Code").click();
  await expect(editor(page)).toBeVisible();
  // line 24 of the f205 fixture is `greeted = GREET(ch_names, params.greeting)`
  await appendToLine(page, 24, " )");
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "refused");
  await page.getByRole("tab", { name: "SHOUT" }).click();
  await expect(page.locator(".code-pane")).toHaveAccessibleName(
    "Code of workflows.nf",
  );
  await expect(syncStatus(page)).toHaveAttribute("data-sync", "idle");
  await expect(syncStatus(page)).toHaveText("");
});

/** Waits for the editor, Shiki's token colours and a settled layout, then hides what blinks or follows focus. */
async function visualReady(page: Page): Promise<Locator[]> {
  await expect(editor(page)).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator(".monaco-editor .view-line span[class^='mtk']")
        .evaluateAll(
          (els) => new Set(els.map((el) => el.getAttribute("class"))).size,
        ),
    )
    .toBeGreaterThan(2);
  await layoutSettled(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  return [
    page.locator(".monaco-editor .cursors-layer"),
    page.locator(".monaco-editor .current-line"),
    page.locator(".monaco-editor .current-line-margin"),
  ];
}

test.describe("F-208 views, visual", () => {
  test(
    "F-208 UX-27: Split and Code views match their approved baselines",
    { tag: VISUAL_TAG },
    async ({ page }, testInfo) => {
      await page.goto("./");
      await openCodeFixture(page);
      await canvasReady(page);
      const centre = page.locator(".column-centre");
      const problems: string[] = [];
      const check = async (name: string, mask: Locator[]) => {
        try {
          await expectBaseline(page, testInfo, `view-modes-${name}.png`, {
            target: centre,
            mask,
          });
        } catch (error) {
          problems.push(String(error instanceof Error ? error.message : error));
        }
      };
      await radio(page, "Split").click();
      await check("split", await visualReady(page));
      await radio(page, "Code").click();
      await check("code", await visualReady(page));
      await radio(page, "Split").click();
      await appendToLine(page, lineNumberOf(F208_BEFORE, GREETED_LINE), " )");
      await expect(syncStatus(page)).toHaveAttribute("data-sync", "refused");
      await expect(page.locator(".squiggly-error").first()).toBeVisible();
      await check("split-refused", await visualReady(page));
      expect(problems, problems.join("\n")).toEqual([]);
    },
  );
});
