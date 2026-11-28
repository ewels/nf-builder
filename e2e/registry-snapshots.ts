import type { FrameLocator, Locator, Page } from "@playwright/test";

const REGISTRY_HOST = "registry.nextflow.io";

/** Adds `extra` modules `nf-core/tool0000…` to a snapshot index body, re-sorted by name. */
export function largeIndex(fixture: object, extra: number): object {
  const index = fixture as {
    modules: { name: string; [key: string]: unknown }[];
  };
  const template = index.modules[0];
  if (!template) throw new Error("The fixture index has no modules");
  const added = Array.from({ length: extra }, (_, i) => ({
    ...template,
    name: `nf-core/tool${String(i).padStart(4, "0")}`,
    description: `Generated tool ${i}`,
    keywords: [],
  }));
  const modules = [...index.modules, ...added].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return { ...index, modules };
}

/** Serves `body(fixture)` for the snapshot index, the fixture being what the site really serves. */
export async function routeIndex(
  page: Page,
  body: (fixture: object) => object,
): Promise<void> {
  await page.route("**/registry/index.json", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: body(await response.json()) });
  });
}

export const registryRegion = (scope: Page | FrameLocator): Locator =>
  scope.getByRole("region", { name: REGISTRY_HOST });

/** A registry row, by its full name (the visible label is the short one). */
export const moduleRow = (scope: Page | FrameLocator, name: string): Locator =>
  registryRegion(scope).locator(`[data-name="${name}"]`);
