import type {
  LanguagePack,
  TemplateInfo,
  TemplateSet,
} from "@nf-builder/lang-core";
import type { ProjectFile } from "./model/project";
import { perPack } from "./packs";

/** What the new-project dialog needs (F-203): the template ids, names and descriptions, with no file text. */
export interface TemplateList {
  readonly version: string;
  readonly blank: TemplateInfo;
  readonly templates: readonly TemplateInfo[];
}

/** The installed pack's templates for a version, memoised per pack; a rejected load is retried. */
export const loadTemplateSet = /* @__PURE__ */ perPack(
  (pack): Promise<TemplateSet> => pack.loadTemplates(),
);

const info = ({ id, name, description }: TemplateInfo): TemplateInfo => ({
  id,
  name,
  description,
});

export async function templateList(
  version: string,
  packs?: readonly LanguagePack[],
): Promise<TemplateList> {
  const set = await loadTemplateSet(version, packs);
  return {
    version,
    blank: info(set.blank),
    templates: set.templates.map(info),
  };
}

/** One template's files, sorted by path. Rejects for an unknown id, naming the id and the version. */
export async function templateFiles(
  version: string,
  id: string,
  packs?: readonly LanguagePack[],
): Promise<readonly ProjectFile[]> {
  const set = await loadTemplateSet(version, packs);
  const found = [set.blank, ...set.templates].find((t) => t.id === id);
  if (!found) {
    throw new Error(`No template "${id}" for Nextflow ${version}`);
  }
  return found.files.map(({ path, text }) => ({ path, text }));
}
