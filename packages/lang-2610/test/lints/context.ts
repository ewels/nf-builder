// A lint context for unit tests: one file, its own declarations for `lookup`, no includes (the engine tests cover those).
import type {
  Catalogue,
  LintContext,
  LintFinding,
  LintRule,
  ScriptAst,
} from "@nf-builder/lang-core";
import { configCatalogue, scriptCatalogue } from "../../src/catalogue.ts";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";

export const catalogue: Catalogue = {
  script: scriptCatalogue,
  config: configCatalogue,
};

export function context(
  text: string,
  language: "script" | "config" = "script",
): LintContext {
  const file =
    language === "script"
      ? ({
          path: "main.nf",
          text,
          language: "nextflow",
          ...parseScriptSource(text),
          comments: [],
        } as never)
      : ({
          path: "nextflow.config",
          text,
          language: "config",
          ...parseConfigSource(text),
          comments: [],
        } as never);
  const ast = (file as { ast: ScriptAst | null }).ast;
  return {
    file,
    catalogue,
    lookup: (name) => {
      const declaration = ast?.body.find(
        (d) =>
          "name" in d &&
          typeof d.name === "object" &&
          d.name !== null &&
          d.name.name === name,
      );
      return declaration
        ? ({ declaration, typesEnabled: true } as never)
        : undefined;
    },
    includes: [],
    projections: () => [],
    configs: () => [],
  };
}

/** Runs one rule over `text`. */
export const run = (
  rule: LintRule,
  text: string,
  language?: "script" | "config",
) => rule.check(context(text, language));

/** The source text each finding covers. */
export const at = (text: string, findings: readonly LintFinding[]) =>
  findings.map((f) => text.slice(f.range.start, f.range.end));
