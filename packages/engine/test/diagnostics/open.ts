import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LanguagePack, PackLints } from "@nf-builder/lang-core";
import {
  createDiagnoser,
  type Diagnoser,
} from "../../src/diagnostics/diagnose";
import { loadLints } from "../../src/diagnostics/lints";
import type { ProjectFile, ProjectModel } from "../../src/model/project";
import { openProject } from "../../src/model/project";
import { installedPacks } from "../../src/packs";
import { createProjector } from "../../src/projection/project";

const pack = installedPacks[0] as LanguagePack;
const version = pack.version;

/** The pack's lint fixtures: `<code>/{positive,negative,fixed}/` trees. */
export const FIXTURES = join(
  import.meta.dirname,
  "../../../lang-2610/test/lints/fixtures",
);

/** Opens a project of in-memory files and diagnoses it with the installed pack's lints. */
export async function diagnoseFiles(
  files: readonly ProjectFile[],
  lints?: PackLints,
): Promise<{ model: ProjectModel; diagnoser: Diagnoser; lints: PackLints }> {
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

/** Every `<code>/<kind>` fixture tree, sorted. */
export function fixtureDirs() {
  return readdirSync(FIXTURES)
    .sort()
    .flatMap((code) =>
      (["positive", "negative", "fixed"] as const).flatMap((kind) => {
        const dir = `${FIXTURES}/${code}/${kind}`;
        return existsSync(dir) ? [{ code, kind, dir }] : [];
      }),
    );
}
