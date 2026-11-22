// The lazily loaded parser chunk (ADR 0027): `pack.loadParser()` imports this module and nothing else. The printer (F-110)
// joins the parser object here, so one dynamic import carries both.
import type { SourceParser } from "@nf-builder/lang-core";
import { scriptPrinter } from "../printer/index.ts";
import { parseConfigSource, parseScriptSource } from "./parse-source.ts";

export const parser: SourceParser = {
  parseScript: parseScriptSource,
  parseConfig: parseConfigSource,
  printer: scriptPrinter,
};
