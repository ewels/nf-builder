import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { canvasReady, openProject } from "./canvas.ts";
import { editor, monacoChunks, radio } from "./code-view.ts";
import {
  addScope,
  addSelector,
  configCard,
  configDetails,
  configReady,
  F601_CONFIG,
  F601_CONFIG_AFTER,
  F601_FORMS_AFTER,
  F601_SELECTORS,
  F601_UNKNOWN,
  F601_UNKNOWN_AFTER,
  openConfigTab,
  optionField,
  projectFile,
  selectorCard,
} from "./config.ts";
import { readProject } from "./engine.ts";
import { historyStatus } from "./history.ts";
import { editorSelection, engineDiagnostics } from "./problems.ts";
import { switcher } from "./projects.ts";
import { NARROW, resize, WIDE } from "./read-only.ts";
import { createFromTemplate } from "./templates.ts";

test("F-601 UX-31 UX-27: the entry summary links nextflow.config, which opens as a config tab with Form, Split and Code", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_FORMS_AFTER);
  await expect(
    page.getByRole("tab", { name: "nextflow.config" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(radio(page, "Form")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".code-pane")).toHaveCount(0);
  await expect(configCard(page, "process")).toBeVisible();
  // the values are the file's, and nothing loaded the code editor
  await expect(optionField(configCard(page, "process"), "memory")).toHaveValue(
    "2.GB",
  );
  await radio(page, "Split").click();
  await expect(page.locator(".code-pane")).toBeVisible();
  await expect(configCard(page, "process")).toBeVisible();
  await radio(page, "Code").click();
  await expect(configCard(page, "process")).toHaveCount(0);
  await radio(page, "Form").click();
  await expect(configCard(page, "process")).toBeVisible();
});

test("F-601 FI-04: selecting an option shows its description, type and docs link in the right pane", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_FORMS_AFTER);
  await expect(
    page.getByText("Select an option to see its description"),
  ).toBeVisible();
  await optionField(configCard(page, "process"), "memory").focus();
  await expect(configDetails(page)).toContainText("process.memory");
  await expect(configDetails(page)).toContainText("MemoryUnit");
  await expect(
    configDetails(page).getByRole("link", { name: "Open in Nextflow docs" }),
  ).toHaveAttribute(
    "href",
    "https://docs.seqera.io/nextflow/reference/process/directives/memory",
  );
  // the description comes from the catalogue, without its Read more line
  await expect(configDetails(page)).not.toContainText("Read more");
  await optionField(configCard(page, "docker"), "enabled").focus();
  await expect(configDetails(page)).toContainText("docker.enabled");
});

test("F-601 FI-03 FI-05: an unknown option is flagged and kept, and an includeConfig line opens the included file in its own config tab", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_UNKNOWN);
  const process = configCard(page, "process");
  const memmory = process.locator('[data-option="memmory"]');
  await expect(memmory).toContainText("Unknown option");
  await expect(memmory.locator("input")).toHaveValue("'4 GB'");
  await memmory.locator("input").focus();
  await expect(configDetails(page)).toContainText("Unknown option");
  await page.getByRole("button", { name: "Open conf/extra.config" }).click();
  await expect(page.getByRole("tab", { name: "extra.config" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-config-state="ready"]')).toBeVisible();
  const mystery = configCard(page, "mystery");
  await expect(mystery).toContainText("Unknown scope");
});

test("F-601 FI-06: selectors show how many processes they match, as Nextflow applied them", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_SELECTORS);
  const expected: [string, string][] = [
    ["withName: GREET", "used by 1 process"],
    ["withName: '.*:GREET'", "used by 1 process"],
    ["withName: 'GREETING:GREET'", "used by 1 process"],
    ["withName: '!TWICE.*'", "used by 2 processes"],
    ["withLabel: big_mem", "used by 1 process"],
    ["withName: 'SHOUT|TWICE_A'", "used by 2 processes"],
    ["withName: TWICE", "used by 2 processes"],
    ["withName: TWICE_A", "used by 1 process"],
    ["withLabel: '!big_mem'", "used by 3 processes"],
    ["withName: '.*:SHOUT'", "used by no process"],
    ["withName: NOPE", "used by no process"],
  ];
  for (const [written, text] of expected)
    await expect(
      selectorCard(page, written).first().locator(".config-card-summary"),
      written,
    ).toHaveText(text);
});

test("F-601 F-703 UX-04: below 1024 px a config tab shows the file note, not the form or the code, and the form is back when the window widens", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.goto("./");
  await openConfigTab(page, F601_FORMS_AFTER);
  await expect(configCard(page, "process")).toBeVisible();
  await resize(page, NARROW);
  await expect(page.locator(".read-only-file-note")).toHaveText(
    "This file opens in the code view on screens 1024 px or wider.",
  );
  await expect(page.locator(".config-pane")).toHaveCount(0);
  await expect(page.locator(".code-pane")).toHaveCount(0);
  await resize(page, WIDE);
  await expect(configCard(page, "process")).toBeVisible();
});

const fixtureFile = (dir: string, path: string): string =>
  readFileSync(join(dir, path), "utf8");

test("F-601 step 1 FI-02 FI-06 AR-23: set process memory and a withLabel selector through the forms; the code matches f601-config-after, has no problems, and four undos restore the file", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_CONFIG);
  await addScope(page, "process");
  const process = configCard(page, "process");
  const memory = optionField(process, "memory");
  await memory.fill("2.GB");
  await memory.press("Enter");
  await expect
    .poll(() => projectFile(page, "nextflow.config"))
    .toContain("memory = 2.GB");
  await addSelector(page, "withLabel", "big_mem");
  const selector = selectorCard(page, "withLabel: big_mem");
  await expect(selector.locator(".config-card-summary")).toHaveText(
    "used by 1 process",
  );
  const inner = selector.locator('[data-option="memory"] input');
  await inner.fill("8.GB");
  await inner.press("Enter");
  const after = fixtureFile(F601_CONFIG_AFTER, "nextflow.config");
  await expect.poll(() => projectFile(page, "nextflow.config")).toBe(after);
  // Split shows the same text
  await radio(page, "Split").click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "withLabel: big_mem",
  );
  expect(
    (await engineDiagnostics(page)).filter((d) => d.path === "nextflow.config"),
  ).toEqual([]);
  const before = fixtureFile(F601_CONFIG, "nextflow.config");
  for (let i = 4; i > 0; i--) {
    await expect
      .poll(async () => (await historyStatus(page)).undoCount)
      .toBe(i);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
  }
  await expect.poll(() => projectFile(page, "nextflow.config")).toBe(before);
});

test("F-601 step 2 FI-03: an unknown option in an existing config is kept and flagged; setting cpus leaves it byte for byte", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_UNKNOWN);
  const process = configCard(page, "process");
  await expect(process.locator('[data-option="memmory"]')).toContainText(
    "Unknown option",
  );
  const cpus = optionField(process, "cpus");
  await cpus.fill("2");
  await cpus.press("Enter");
  await expect
    .poll(() => projectFile(page, "nextflow.config"))
    .toBe(fixtureFile(F601_UNKNOWN_AFTER, "nextflow.config"));
  const warnings = (await engineDiagnostics(page)).filter(
    (d) => d.code === "config-unknown-option",
  );
  expect(warnings.map((d) => d.severity)).toEqual(["warning", "warning"]);
  expect(
    warnings.some((d) =>
      d.message.startsWith("Unrecognized config option 'process.memmory'"),
    ),
  ).toBe(true);
});

test("F-601 FI-03: Add scope lists every scope in the catalogue with its description", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_CONFIG);
  await page.getByRole("button", { name: "Add scope…" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add scope" });
  const catalogue = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "packages/lang-2610/catalogue/config.json"),
      "utf8",
    ),
  ) as { scopes: { name: string; kind: string; description: string }[] };
  const expected = catalogue.scopes
    .filter((n) => n.kind !== "option")
    .map((n) => n.name);
  const names = await dialog
    .locator(".config-pick-group:not(:has(h3)) .config-pick-name")
    .allTextContents();
  expect(names).toEqual(expected);
  // the manifest scope is in use, and every entry has a description
  await expect(
    dialog.getByRole("button", { name: /^manifest\b/ }),
  ).toBeDisabled();
  const described = (
    catalogue.scopes as { kind: string; description: string }[]
  ).filter((n) => n.kind !== "option" && n.description.trim() !== "").length;
  const shown = (
    await dialog.locator(".config-pick-description").allTextContents()
  ).filter((t) => t.trim() !== "").length;
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeGreaterThanOrEqual(described);
  await dialog.getByLabel("Filter scopes").fill("docker");
  await expect(dialog.locator(".config-pick-name")).toContainText(["docker"]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("F-601 UX-27: on a config tab a form edit updates the Split code and a code edit updates the form; Form mode loads no Monaco", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await page.goto("./");
  await openConfigTab(page, F601_FORMS_AFTER);
  const chunks = monacoChunks().map((f) => `/${f}`);
  expect(requested.filter((p) => chunks.some((c) => p.endsWith(c)))).toEqual(
    [],
  );
  await radio(page, "Split").click();
  await expect(editor(page)).toBeVisible();
  const cpus = optionField(configCard(page, "process"), "cpus");
  await cpus.fill("3");
  await cpus.press("Enter");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "cpus = 3",
  );
  // a code edit reaches the form
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\nworkDir = 'work'\n");
  await expect(
    optionField(configCard(page, ""), "workDir").or(
      page.locator('[data-option="workDir"] input'),
    ),
  ).toHaveValue("work");
});

test("F-601: a dynamic value is read-only, and Edit in code reveals it in Split", async ({
  page,
}) => {
  await page.goto("./");
  const files = readProject(F601_CONFIG).map((f) =>
    f.path === "nextflow.config"
      ? {
          path: f.path,
          text: "process {\n    memory = { 2.GB * task.attempt }\n}\n",
        }
      : f,
  );
  await openProject(page, files);
  await canvasReady(page);
  await page.getByRole("button", { name: "Open nextflow.config" }).click();
  const field = optionField(configCard(page, "process"), "memory");
  await expect(field).toHaveValue("{ 2.GB * task.attempt }");
  await expect(field).toHaveJSProperty("readOnly", true);
  await configCard(page, "process")
    .getByRole("button", { name: "Edit in code" })
    .click();
  await expect(radio(page, "Split")).toHaveAttribute("aria-checked", "true");
  await expect(editor(page)).toBeVisible();
  await expect.poll(() => editorSelection(page)).toBe("2:5-2:37");
});

test("F-601 F-203: manifest.name is set through the form on a Hello world project", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createFromTemplate(page, "Hello world", "Hello config");
  await canvasReady(page);
  await page.getByRole("button", { name: "Open nextflow.config" }).click();
  await configReady(page);
  const name = optionField(configCard(page, "manifest"), "name");
  await name.fill("hello");
  await name.press("Enter");
  await expect
    .poll(() => projectFile(page, "nextflow.config"))
    .toContain("name = 'hello'");
});

test("F-601 UX-70 QA-11: the form, the Add scope dialog and the option fields work by keyboard", async ({
  page,
}) => {
  await page.goto("./");
  await openConfigTab(page, F601_CONFIG);
  // G, S and C switch modes outside fields
  await page
    .locator(".config-pane")
    .getByRole("button", { name: "Add scope…" })
    .focus();
  await page.keyboard.press("s");
  await expect(radio(page, "Split")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("g");
  await expect(radio(page, "Form")).toHaveAttribute("aria-checked", "true");
  // a letter typed in a field never switches the mode
  const description = optionField(configCard(page, "manifest"), "description");
  await description.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("sc");
  await expect(radio(page, "Form")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(description).toHaveValue("Greets and shouts");
  // Add scope by keyboard
  await page.getByRole("button", { name: "Add scope…" }).first().focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add scope" });
  await expect(dialog.getByLabel("Filter scopes")).toBeFocused();
  await page.keyboard.type("docker");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await expect(configCard(page, "docker")).toBeVisible();
  await expect
    .poll(() => projectFile(page, "nextflow.config"))
    .toContain("docker {");
  // a pinned field is reached by Tab and commits on Enter
  const enabled = optionField(configCard(page, "docker"), "enabled");
  await enabled.focus();
  await page.keyboard.press("ArrowDown");
  await expect(enabled).toHaveValue("true");
});
