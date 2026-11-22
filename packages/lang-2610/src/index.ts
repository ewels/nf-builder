import type {
  ConfigCatalogue,
  LanguagePack,
  ScriptCatalogue,
} from "@nf-builder/lang-core";
import { palette } from "./palette.ts";

// Import the catalogue JSON only dynamically here: it must stay lazy chunks that come straight from JSON (QA-01, ADR 0028).
export const pack: LanguagePack = {
  version: "26.10",
  palette,
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
  // Import the parser only dynamically here: it stays a lazy chunk (QA-01, ADR 0027). The printer (F-110) joins the
  // same chunk module, so one import carries both.
  loadParser: async () => (await import("./source/index.ts")).parser,
};
