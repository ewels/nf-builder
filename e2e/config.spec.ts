import { expect, test } from "@playwright/test";
import { radio } from "./code-view.ts";
import {
  configCard,
  configDetails,
  F601_FORMS_AFTER,
  F601_SELECTORS,
  F601_UNKNOWN,
  openConfigTab,
  optionField,
  selectorCard,
} from "./config.ts";
import { NARROW, resize, WIDE } from "./read-only.ts";

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
