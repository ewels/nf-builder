// A lint context for unit tests: one file, its own declarations for `lookup`, no includes (the engine tests cover those).
import { readFileSync } from "node:fs";
import type { Catalogue, LintContext, ScriptAst } from "@nf-builder/lang-core";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";

const json = (file: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../catalogue/${file}`, import.meta.url), "utf8"),
  );
export const catalogue = {
  script: json("script.json"),
  config: json("config.json"),
} as Catalogue;

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
        ? ({
            declaration,
            path: "main.nf",
            typesEnabled: true,
            entry: null,
          } as never)
        : undefined;
    },
    includes: [],
    projections: () => [],
    configs: () => [],
  };
}
