// F-405: nf-core/rnaseq 3.28.0, imported through the mocked GitHub route, shows no typed badge on its legacy components,
// counts its suggestions in the status bar and shows how much of each workflow is modelled (UX-23, UX-03, UX-31).
import { expect, test } from "@playwright/test";
import { canvasReady, clickEmptyCanvas, node, openWorkflow } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import { detailsSection } from "./details.ts";
import type { EngineHook } from "./engine.ts";
import { importFromGithub, reportDialog } from "./github-import.ts";
import { corpusRepo, mockGithub } from "./github-mock.ts";
import { engineDiagnostics, problemsPanel, statusCount } from "./problems.ts";
import { switcher } from "./projects.ts";

interface Projected {
  workflow: { path: string; range: { start: number; end: number } };
  statements: { modelled: boolean }[];
  nodes: {
    id: string;
    kind: string;
    callee?: { path: string | null; typed: boolean | null };
  }[];
}

const RNASEQ = "workflows/rnaseq/main.nf";

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("F-405 step 1 UX-23 ADR-0007 UX-03 ADR-0004 UX-31: an imported legacy pipeline has no typed badges, counts its suggestions and shows its modelled share", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "needs the pinned corpus");
  const csp = await watchForCspViolations(page);
  await mockGithub(page, [corpusRepo("rnaseq", "nf-core/rnaseq", "3.28.0")]);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await importFromGithub(page, "nf-core/rnaseq", "3.28.0");
  const report = reportDialog(page);
  await expect(report).toBeVisible({ timeout: 120_000 });
  const live = await page.evaluate(() =>
    (
      window as unknown as { nfBuilderEngine: EngineHook }
    ).nfBuilderEngine.report(),
  );
  const suggestionsInReport = live.diagnostics?.suggestions ?? 0;
  await expect(report).toContainText(`${suggestionsInReport} suggestion`);
  await report.getByRole("button", { name: "Close" }).click();
  await report.waitFor({ state: "hidden" });

  await test.step("nf-core process calls carry no typed badge", async () => {
    await openWorkflow(page, RNASEQ, "RNASEQ");
    await canvasReady(page);
    const projected = await page.evaluate(
      async ({ path }) => {
        const engine = (window as unknown as { nfBuilderEngine: EngineHook })
          .nfBuilderEngine;
        const { projection } = (await engine.project(path, "RNASEQ")) as {
          projection: Projected;
        };
        return {
          nodes: projection.nodes,
          statements: projection.statements,
        } as Projected;
      },
      { path: RNASEQ },
    );
    const modules = projected.nodes.filter(
      (n) =>
        n.kind === "call" && n.callee?.path?.startsWith("modules/nf-core/"),
    );
    expect(modules.length).toBeGreaterThanOrEqual(10);
    for (const n of modules.slice(0, 10)) {
      await expect(node(page, n.id)).toBeVisible();
      await expect(node(page, n.id).locator(".canvas-badge")).toHaveCount(0);
      expect(
        (await node(page, n.id).getAttribute("aria-label")) ?? "",
      ).not.toMatch(/typed/i);
    }
    await expect(page.locator(".canvas-badge")).toHaveCount(0);
  });

  await test.step("the status bar counts the import's suggestions, registry modules last", async () => {
    const diagnostics = await engineDiagnostics(page);
    const suggestions = diagnostics.filter((d) => d.severity === "suggestion");
    expect(suggestions.length).toBe(suggestionsInReport);
    expect(suggestions.length).toBeGreaterThanOrEqual(108);
    const button = statusCount(page, "suggestions");
    await expect(button).toContainText(String(suggestions.length));
    await button.click();
    const panel = problemsPanel(page);
    await expect(panel).toBeVisible();
    const headings = await panel.locator(".problems-file").allTextContents();
    const firstRegistry = headings.findIndex((h) =>
      h.includes("modules/nf-core/"),
    );
    expect(firstRegistry).toBeGreaterThan(0);
    expect(
      headings.slice(firstRegistry).every((h) => h.includes("registry")),
    ).toBe(true);
    expect(
      headings.slice(0, firstRegistry).some((h) => h.includes("registry")),
    ).toBe(false);
    await expect(panel.locator(".problems-subheading")).toContainText(
      "Registry modules",
    );
    await panel.getByRole("button", { name: "Close problems panel" }).click();
  });

  await test.step("the workflow summary shows how much of each workflow is modelled", async () => {
    await clickEmptyCanvas(page);
    const projected = await page.evaluate(
      async ({ path }) => {
        const engine = (window as unknown as { nfBuilderEngine: EngineHook })
          .nfBuilderEngine;
        const { projection } = (await engine.project(path, "RNASEQ")) as {
          projection: Projected;
        };
        return projection;
      },
      { path: RNASEQ },
    );
    const statements = {
      total: projected.statements.length,
      modelled: projected.statements.filter((s) => s.modelled).length,
    };
    const percent = Math.floor((100 * statements.modelled) / statements.total);
    expect(percent).toBeLessThan(100);
    const modelled = detailsSection(page, "Modelled");
    await expect(modelled).toContainText(
      `${statements.modelled} of ${statements.total} statements (${percent}%)`,
    );
    await expect(modelled).toHaveAttribute(
      "data-coverage",
      `${statements.modelled}/${statements.total}`,
    );
    const { range } = projected.workflow;
    const own = (await engineDiagnostics(page)).filter(
      (d) =>
        d.severity === "suggestion" &&
        d.path === projected.workflow.path &&
        d.range.start >= range.start &&
        d.range.end <= range.end,
    ).length;
    expect(own).toBeGreaterThan(0);
    await expect(detailsSection(page, "Suggestions")).toContainText(
      `${own} suggestion${own === 1 ? "" : "s"} in this workflow`,
    );
    // relative includes of registry module files are listed, as the problems panel tags them (ADR 0055)
    const modules = [
      ...new Set(
        projected.nodes.flatMap((n) => {
          const dir = n.callee?.path?.match(/^modules\/(nf-core\/.+)\/[^/]+$/);
          return n.kind === "call" && dir?.[1] ? [dir[1]] : [];
        }),
      ),
    ];
    expect(modules.length).toBeGreaterThan(0);
    expect(
      (
        await detailsSection(page, "Registry modules")
          .locator(".details-port-name")
          .allTextContents()
      ).sort(),
    ).toEqual(modules.sort());
    await openWorkflow(page, "main.nf", null);
    await canvasReady(page);
    await clickEmptyCanvas(page);
    await expect(detailsSection(page, "Modelled")).toContainText(
      "All 3 statements (100%)",
    );
  });

  expect(await csp.violations()).toEqual([]);
  expect(csp.consoleErrors).toEqual([]);
});
