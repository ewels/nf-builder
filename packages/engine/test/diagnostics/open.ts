import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackLints } from "@nf-builder/lang-core";
import {
  createDiagnoser,
  type Diagnoser,
} from "../../src/diagnostics/diagnose";
import { loadLints } from "../../src/diagnostics/lints";
import type { ProjectFile, ProjectModel } from "../../src/model/project";
import { openProject } from "../../src/model/project";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { createProjector } from "../../src/projection/project";
import { readTree } from "../model/read-tree";

const version = installedPackVersions()[0] as string;

/** The pack's lint fixtures: `<code>/{positive,negative,fixed}/` trees. */
export const FIXTURES = fileURLToPath(
  new URL("../../../lang-2610/test/lints/fixtures/", import.meta.url),
).replace(/\/$/, "");

/** Opens a project of in-memory files and diagnoses it with the installed pack's lints. */
export async function diagnoseFiles(
  files: readonly ProjectFile[],
  lints?: PackLints,
): Promise<{ model: ProjectModel; diagnoser: Diagnoser; lints: PackLints }> {
  const pack = installedPacks.find((p) => p.version === version);
  if (!pack) throw new Error("no pack installed");
  const model = await openProject(version, files);
  const catalogue = await pack.loadCatalogue();
  const projector = createProjector(model, catalogue.script, {
    legacyOperators: pack.legacyOperators,
  });
  const used = lints ?? (await loadLints(version));
  return {
    model,
    lints: used,
    diagnoser: createDiagnoser({ model, projector, catalogue, lints: used }),
  };
}

/** Opens every file under `dir` as its own project and diagnoses it. */
export function diagnoseTree(dir: string) {
  return diagnoseFiles(readTree(dir));
}

/** Every `<code>/<kind>` fixture tree, sorted. */
export function fixtureDirs(): readonly {
  code: string;
  kind: "positive" | "negative" | "fixed";
  dir: string;
}[] {
  const out: {
    code: string;
    kind: "positive" | "negative" | "fixed";
    dir: string;
  }[] = [];
  for (const code of readdirSync(FIXTURES).sort())
    for (const kind of ["positive", "negative", "fixed"] as const)
      try {
        readdirSync(`${FIXTURES}/${code}/${kind}`);
        out.push({ code, kind, dir: `${FIXTURES}/${code}/${kind}` });
      } catch {
        // this code has no tree of this kind
      }
  return out;
}
