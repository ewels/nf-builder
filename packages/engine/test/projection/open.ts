import type { ProjectFile, ProjectModel } from "../../src/model/project";
import { openProject } from "../../src/model/project";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { createProjector, type Projector } from "../../src/projection/project";
import { readTree } from "../model/read-tree";

const version = installedPackVersions()[0] as string;

/** The fixture tree's probe lines (`def probeN: Boolean = <expr>`) are type reveals for the oracle, not workflow code. */
const PROBE = /^\s*def probe\d+: Boolean = .*\n/gm;

export const stripProbeLines = (text: string): string =>
  text.replace(PROBE, "");

export function openFiles(files: ProjectFile[]): Promise<ProjectModel> {
  return openProject(version, files);
}

/** Opens every file under `dir`, with the type-probe lines left out when asked. */
export function openTree(
  dir: string,
  options: { stripProbes?: boolean } = {},
): Promise<ProjectModel> {
  const files = readTree(dir).map((f) =>
    options.stripProbes ? { ...f, text: stripProbeLines(f.text) } : f,
  );
  return openFiles(files);
}

/** A projector over `model` with the installed pack's catalogue. */
export async function projectorFor(model: ProjectModel): Promise<Projector> {
  const pack = installedPacks[0];
  if (pack === undefined) throw new Error("no pack installed");
  return createProjector(model, (await pack.loadCatalogue()).script);
}

/** Opens a small project of `path -> text` pairs and projects it. */
export async function projectorForFiles(
  files: Record<string, string>,
): Promise<Projector> {
  return projectorFor(
    await openFiles(
      Object.entries(files).map(([path, text]) => ({ path, text })),
    ),
  );
}
