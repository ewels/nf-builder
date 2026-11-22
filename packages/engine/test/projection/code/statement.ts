import type { Statement, WorkflowDef } from "@nf-builder/lang-core";
import { installedPackVersions } from "../../../src/packs";
import { loadParser } from "../../../src/source/parser";

/** Parses scripts with the installed pack's parser, for the F-108 tests. */
export async function scriptParser(types = false) {
  const parser = await loadParser(installedPackVersions()[0] as string);
  const flag = types ? "nextflow.enable.types = true\n\n" : "";
  return {
    /** The first top-level statement of `text`. */
    statement(text: string): Statement {
      const ast = parser.parseScript(`${flag}${text}\n`).ast;
      const item = ast?.body.find((i) => i.kind !== "FeatureFlag");
      if (item === undefined) throw new Error(`no statement in ${text}`);
      return item as Statement;
    },
    /** The body statements of every workflow in `text`, by workflow name. */
    workflows(text: string): Map<string, readonly Statement[]> {
      const ast = parser.parseScript(text).ast;
      const out = new Map<string, readonly Statement[]>();
      for (const item of ast?.body ?? [])
        if (item.kind === "Workflow")
          out.set(
            (item as WorkflowDef).name?.name ?? "",
            (item as WorkflowDef).main?.items ?? [],
          );
      return out;
    },
  };
}
