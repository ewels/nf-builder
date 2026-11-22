import type {
  ConfigCatalogue,
  LanguagePack,
  ScriptCatalogue,
} from "@nf-builder/lang-core";
import { includes } from "./includes/index.ts";
import { palette } from "./palette.ts";
import { scaffold } from "./scaffold.ts";

// Import the catalogue JSON only dynamically here: it must stay lazy chunks that come straight from JSON (QA-01, ADR 0028).
export const pack: LanguagePack = {
  version: "26.10",
  palette,
  includes,
  scaffold,
  loadCatalogue: async () => {
    const [script, config] = await Promise.all([
      import("../catalogue/script.json"),
      import("../catalogue/config.json"),
    ]);
    return {
      script: script.default as ScriptCatalogue,
      config: config.default as ConfigCatalogue,
    };
  },
  // Import the parser (and the printer with it) only dynamically here: it stays a lazy chunk (QA-01, ADR 0027).
  loadParser: async () => (await import("./source/index.ts")).parser,
};
