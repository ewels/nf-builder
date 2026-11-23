// An in-memory project as the details functions take it (F-206).
import type { Projection } from "@nf-builder/lang-core";
import type { DetailsInput } from "../../src/details/declaration";
import { installedPacks } from "../../src/packs";
import { createProjector } from "../../src/projection/project";
import { openFiles } from "../projection/open";

export async function detailsOf(
  files: Record<string, string>,
  path = "main.nf",
  workflow: string | null = null,
): Promise<DetailsInput> {
  const model = await openFiles(
    Object.entries(files).map(([p, text]) => ({ path: p, text })),
  );
  const pack = installedPacks[0];
  if (pack === undefined) throw new Error("no pack installed");
  const catalogue = await pack.loadCatalogue();
  const projector = createProjector(model, catalogue.script, {
    legacyOperators: pack.legacyOperators,
  });
  const projection: Projection | null = projector.project(path, workflow);
  if (projection === null) throw new Error(`no projection for ${path}`);
  return { model, catalogue: catalogue.script, projection };
}

export function nodeNamed(input: DetailsInput, label: string) {
  const node = input.projection.nodes.find((n) => n.label === label);
  if (node === undefined) throw new Error(`no node ${label}`);
  return node;
}
