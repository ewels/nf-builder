// Config lints (F-601, FI-03). `nextflow lint` doesn't validate option names; Nextflow's run-time `ConfigValidator` does.
import type { LintFinding, LintRule } from "@nf-builder/lang-core";
import { classifyPath, optionPaths } from "../config/validator.ts";

/**
 * `ConfigValidator.groovy#L107-L231`: an option the config catalogue doesn't know. The message starts with the run-time
 * warning. Plugin scopes stay flagged until the plugin specs join the catalogue (F-505).
 */
export const configUnknownOption: LintRule = {
  code: "config-unknown-option",
  check: (context) => {
    if (context.file.language !== "config" || !context.file.ast) return [];
    const out: LintFinding[] = [];
    for (const { names, node, range } of optionPaths(context.file.ast)) {
      const found = classifyPath(context.catalogue.config, names);
      // a scope given a map (`docker = [enabled: true]`) holds options this walk doesn't see
      if (found.kind === "scope" && node.value.kind === "Map") continue;
      if (found.kind !== "unknown" && found.kind !== "scope") continue;
      out.push({
        range,
        message: `Unrecognized config option '${names.join(".")}' -- check the name against the config reference, add the plugin that defines it, or remove it`,
      });
    }
    return out;
  },
};
