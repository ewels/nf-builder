import { join } from "node:path";
import type {
  ConfigAssign,
  ConfigAst,
  ConfigName,
  ConfigRules,
  ConfigSourceFile,
  Expression,
  LanguagePack,
  SourceParser,
} from "@nf-builder/lang-core";
import { NO_RANGE } from "@nf-builder/lang-core";
import { processUses } from "../../src/config/uses";
import { configView } from "../../src/config/view";
import type { Diagnoser } from "../../src/diagnostics/diagnose";
import type { ProjectFile, ProjectModel } from "../../src/model/project";
import { installedPacks } from "../../src/packs";
import { loadParser } from "../../src/source/parser";
import { createSourceFile } from "../../src/source/source-file";
import { diagnoseFiles } from "../diagnostics/open";
import { readTree } from "../model/read-tree";

export const pack = installedPacks[0] as LanguagePack;
export const ROOT = join(import.meta.dirname, "../../../..");
export const oracle = (name: string) => join(ROOT, "tools/oracle/cases", name);

export const parser = (): Promise<SourceParser> => loadParser(pack.version);
export const rules = (): Promise<ConfigRules> => pack.loadConfigRules();

/** The `value` of `x = <text>` in a config, parsed. */
export async function expressionOf(text: string): Promise<Expression> {
  const file = createSourceFile("x.config", `x = ${text}\n`, await parser());
  const item = (file.ast as ConfigAst).statements[0] as ConfigAssign;
  return item.value;
}

const name = (n: string): ConfigName => ({
  kind: "ConfigName",
  range: NO_RANGE,
  name: n,
  form: "identifier",
});

/** `x = <value>` built by hand, as a command would. */
export const assignOf = (value: Expression): ConfigAssign => ({
  kind: "ConfigAssign",
  range: NO_RANGE,
  path: [name("x")],
  value,
});

export interface Opened {
  readonly model: ProjectModel;
  readonly diagnoser: Diagnoser;
  view(path: string): ReturnType<typeof configView>;
}

/** Opens a project and gives its config views, with the diagnostics of the installed pack. */
export async function open(
  files: readonly ProjectFile[] | Record<string, string>,
): Promise<Opened> {
  const list = Array.isArray(files)
    ? (files as readonly ProjectFile[])
    : Object.entries(files).map(([path, text]) => ({ path, text }));
  const { model, diagnoser } = await diagnoseFiles(list);
  const configRules = await rules();
  return {
    model,
    diagnoser,
    view: (path) => {
      const file = model.file(path);
      if (!file || file.source.language !== "config")
        throw new Error(`no config ${path}`);
      return configView({
        file: file.source as ConfigSourceFile,
        rules: configRules,
        uses: processUses(model),
        diagnostics: diagnoser.file(path),
        includes: file.includes.filter((i) => i.kind === "config"),
      });
    },
  };
}

export const openTree = (dir: string) => open(readTree(dir));
