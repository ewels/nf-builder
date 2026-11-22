// The 26.10 include rules (ADR 0006, LA-02). Pure and small, so the pack entry imports them statically; they import
// lang-core types only.
import type { IncludeRules } from "@nf-builder/lang-core";
import { includable } from "./includable.ts";
import { configInclude, scriptInclude } from "./resolve.ts";

export const includes: IncludeRules = {
  scriptInclude,
  configInclude,
  includable,
  // ResolveIncludeVisitor.visitInclude (v26.10.7, L90-L141)
  notParsed: (path) => `Module could not be parsed: '${path}'`,
  notDefined: (name, path) =>
    `Included name '${name}' is not defined in module '${path}'`,
};
