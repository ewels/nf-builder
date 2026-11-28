import { expect, type Page, test } from "@playwright/test";
import { VISUAL_TAG } from "./browsers.ts";
import {
  canvasReady,
  clickEmptyCanvas,
  expectBaseline,
  layoutSettled,
  node,
  selectNode,
} from "./canvas.ts";
import {
  DESCRIBE,
  dragConnection,
  edgeInto,
  edgeMidpoint,
  F302_MISMATCH,
  F302_START,
  F302_TYPED,
  handle,
  mainOf,
  PARAMS,
  TOUCH,
} from "./connect.ts";
import { watchForCspViolations } from "./csp.ts";
import { historyStatus, openStoredFixture } from "./history.ts";
import { viewportTransform } from "./palette-add.ts";
import { engineDiagnostics, statusCount } from "./problems.ts";
import { readFile } from "./projects.ts";
import { resize } from "./read-only.ts";

const main = async (page: Page) => (await readFile(page, "main.nf")) ?? "";
const typeErrors = async (page: Page) =>
  (await engineDiagnostics(page)).filter((d) => d.code === "type-mismatch");

/** Drags `TOUCH`'s output onto `DESCRIBE`'s `sample` input. */
const dragMismatch = (page: Page, during?: () => Promise<void>) =>
  dragConnection(
    page,
    { node: TOUCH, handle: "out:out" },
    { node: DESCRIBE, handle: "in:sample" },
    during,
  );

test("F-302 step 1 UX-25 LA-29: dragging params input onto DESCRIBE sample updates main.nf with no diagnostics", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-1", F302_START);
  expect(await main(page)).toBe(mainOf(F302_START));
  await dragConnection(
    page,
    { node: PARAMS, handle: "out:input" },
    { node: DESCRIBE, handle: "in:sample" },
  );
  await expect.poll(() => main(page)).toBe(mainOf(F302_TYPED));
  expect(await typeErrors(page)).toEqual([]);
  const edge = edgeInto(page, DESCRIBE, "sample");
  await expect(edge).toHaveCount(1);
  await expect(edge.locator(".react-flow__edge-path")).not.toHaveClass(
    /is-mismatch/,
  );
});

test("F-302 UX-25: while dragging from DESCRIBE's output, its own input dims as refused and the drop there changes nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-refused", F302_START);
  const before = await historyStatus(page);
  await dragConnection(
    page,
    { node: DESCRIBE, handle: "out:out" },
    { node: DESCRIBE, handle: "in:sample" },
    async () => {
      await expect(handle(page, DESCRIBE, "in:sample")).toHaveClass(
        /is-target-refused/,
      );
      await expect(handle(page, TOUCH, "out:out")).not.toHaveClass(
        /is-target-refused/,
      );
    },
  );
  await expect(handle(page, DESCRIBE, "in:sample")).not.toHaveClass(
    /is-target-refused/,
  );
  expect(await main(page)).toBe(mainOf(F302_START));
  expect(await historyStatus(page)).toEqual(before);
});

test("F-302 step 2 UX-24 LA-32: dragging TOUCH's output onto DESCRIBE sample turns the edge red with the diagnostic on hover", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-2", F302_START);
  await dragMismatch(page, async () => {
    // allowed, but flagged while dragging: dashed ring, not refused
    await expect(handle(page, DESCRIBE, "in:sample")).toHaveClass(
      /is-target-mismatch/,
    );
  });
  await expect.poll(() => main(page)).toBe(mainOf(F302_MISMATCH));
  const errors = await typeErrors(page);
  expect(errors).toHaveLength(1);
  const edge = edgeInto(page, DESCRIBE, "sample");
  const path = edge.locator(".react-flow__edge-path");
  await expect(path).toHaveClass(/is-mismatch/);
  expect(
    await path.evaluate((el) => getComputedStyle(el).stroke),
    "the error colour",
  ).toBe("rgb(155, 28, 28)");
  await expect(page.locator(".edge-mismatch-glyph")).toBeVisible();
  const at = await edgeMidpoint(edge);
  await page.mouse.move(at.x - 20, at.y - 20);
  await page.mouse.move(at.x, at.y, { steps: 5 });
  await expect(page.getByRole("tooltip")).toContainText(
    errors[0]?.message ?? "no message",
  );
  await expect(statusCount(page, "problems")).toHaveAttribute(
    "title",
    /^1 error/,
  );
});

test("F-302 UX-24: mismatch red wins over the selection highlight", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-red", F302_MISMATCH);
  await selectNode(page, DESCRIBE);
  const path = edgeInto(page, DESCRIBE, "sample").locator(
    ".react-flow__edge-path",
  );
  await expect(path).toHaveClass(/is-highlighted/);
  await expect(path).toHaveClass(/is-mismatch/);
  expect(await path.evaluate((el) => getComputedStyle(el).stroke)).toBe(
    "rgb(155, 28, 28)",
  );
});

test(
  "F-302 UX-24 QA-12: a mismatched edge matches its approved baseline",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "one browser is enough");
    await openStoredFixture(page, "connect-visual", F302_MISMATCH);
    await layoutSettled(page);
    const box = await edgeInto(page, DESCRIBE, "sample").boundingBox();
    if (box === null) throw new Error("no edge");
    await expectBaseline(page, testInfo, "connect-mismatch.png", {
      clip: {
        x: Math.max(0, box.x - 24),
        y: Math.max(0, box.y - 24),
        width: box.width + 48,
        height: box.height + 48,
      },
    });
  },
);

test("F-302 step 3 UX-70: clicking an edge and pressing Delete removes the argument; the code still parses, and one undo restores it byte for byte", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-3", F302_TYPED);
  const edge = edgeInto(page, DESCRIBE, "sample");
  const at = await edgeMidpoint(edge);
  await page.mouse.click(at.x, at.y);
  await expect(edge.locator(".react-flow__edge-path")).toHaveClass(
    /is-selected/,
  );
  await page.keyboard.press("Delete");
  await expect.poll(() => main(page)).toBe(mainOf(F302_START));
  await expect(edge).toHaveCount(0);
  const files = await page.evaluate(async () => {
    const hook = (
      window as unknown as {
        nfBuilderEngine: {
          listFiles(): Promise<{ files: { path: string; status: string }[] }>;
        };
      }
    ).nfBuilderEngine;
    return (await hook.listFiles()).files;
  });
  expect(files.find((f) => f.path === "main.nf")?.status).toBe("modelled");
  const undone = await historyStatus(page);
  expect(undone.undo).toBe("Disconnect");
  await clickEmptyCanvas(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => main(page)).toBe(mainOf(F302_TYPED));
});

test("F-302 UX-70 QA-11: focusing an edge and pressing Delete disconnects it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-focus", F302_TYPED);
  const edge = edgeInto(page, DESCRIBE, "sample");
  await edge.focus();
  await expect(edge).toBeFocused();
  await expect(edge).toHaveAttribute(
    "aria-label",
    /Press Delete to disconnect\.$/,
  );
  await page.keyboard.press("Backspace");
  await expect.poll(() => main(page)).toBe(mainOf(F302_START));
});

test("F-302 UX-70 QA-11: Enter selects a focused edge and says so to assistive tech, and Escape clears it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-enter-escape", F302_TYPED);
  const edge = edgeInto(page, DESCRIBE, "sample");
  const path = edge.locator(".react-flow__edge-path");
  await edge.focus();
  await expect(edge).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(path).toHaveClass(/is-selected/);
  await expect(edge).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(path).not.toHaveClass(/is-selected/);
  await expect(edge).toHaveAttribute("aria-pressed", "false");
  expect(await main(page)).toBe(mainOf(F302_TYPED));
});

test("F-302 UX-70: Delete after focus moves from the selected edge to a node disconnects nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-focus-moves", F302_TYPED);
  const edge = edgeInto(page, DESCRIBE, "sample");
  await edge.focus();
  await page.keyboard.press("Enter");
  await expect(edge.locator(".react-flow__edge-path")).toHaveClass(
    /is-selected/,
  );
  await node(page, TOUCH).focus();
  await expect(node(page, TOUCH)).toBeFocused();
  await expect(edge.locator(".react-flow__edge-path")).not.toHaveClass(
    /is-selected/,
  );
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
  expect(await main(page)).toBe(mainOf(F302_TYPED));
  await expect(edge).toHaveCount(1);
});

test("F-302 ADR-0052: connecting keeps the viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-viewport", F302_START);
  await layoutSettled(page);
  const before = await viewportTransform(page);
  await dragMismatch(page);
  await expect.poll(() => main(page)).toBe(mainOf(F302_MISMATCH));
  await layoutSettled(page);
  await page.waitForTimeout(500);
  expect(await viewportTransform(page)).toBe(before);
});

test("F-302 ADR-0056 F-703: read-only, handles don't start a connection and Delete on an edge changes nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  await openStoredFixture(page, "connect-read-only", F302_TYPED);
  await resize(page, { width: 900, height: 800 });
  await canvasReady(page);
  await layoutSettled(page);
  const edge = edgeInto(page, DESCRIBE, "sample");
  await expect(edge).toHaveCount(1);
  await expect(edge).not.toHaveAttribute("aria-label", /Delete/);
  await dragConnection(
    page,
    { node: TOUCH, handle: "out:out" },
    { node: DESCRIBE, handle: "in:sample" },
    async () => {
      await expect(
        page.locator(".is-target-refused, .is-target-mismatch"),
      ).toHaveCount(0);
    },
  );
  const at = await edgeMidpoint(edge);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
  expect(await main(page)).toBe(mainOf(F302_TYPED));
  await expect(node(page, DESCRIBE)).toBeVisible();
  expect((await historyStatus(page)).undoCount).toBe(0);
});

test("F-302 QA-30: connecting and disconnecting log no CSP violation and no console error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "one browser is enough");
  const watch = await watchForCspViolations(page);
  await openStoredFixture(page, "connect-csp", F302_START);
  await dragMismatch(page);
  await expect.poll(() => main(page)).toBe(mainOf(F302_MISMATCH));
  const at = await edgeMidpoint(edgeInto(page, DESCRIBE, "sample"));
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("Delete");
  // the variable `touch` stays; only the argument goes
  await expect.poll(() => main(page)).toContain("DESCRIBE()");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
