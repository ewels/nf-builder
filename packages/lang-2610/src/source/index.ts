// The lazily loaded parser chunk (ADR 0027): `pack.loadParser()` imports this module and nothing else. The printer (F-110)
// is added here as another export, so one dynamic import carries both.
import type { SourceParser } from "@nf-builder/lang-core";
import { parseConfigSource, parseScriptSource } from "./parse-source.ts";

export const parser: SourceParser = {
  parseScript: parseScriptSource,
  parseConfig: parseConfigSource,
};
