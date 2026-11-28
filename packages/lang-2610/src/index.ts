import type {
  ConfigCatalogue,
  ConfigRules,
  LanguagePack,
  ScriptCatalogue,
  TemplateSet,
} from "@nf-builder/lang-core";
import { includes } from "./includes/index.ts";
import { legacyOperators } from "./legacy-operators.ts";
import { palette } from "./palette.ts";
import { scaffold } from "./scaffold.ts";
import { standardTypes } from "./standard-types.ts";

/** The pack's version, exported on its own so the main thread can read it without the pack (F-113). */
export const version = "26.10";

let configRules: Promise<ConfigRules> | undefined;

// Import the catalogue JSON only dynamically here: it must stay lazy chunks that come straight from JSON (QA-01, ADR 0028).
export const pack: LanguagePack = {
  version,
  palette,
  includes,
  scaffold,
  legacyOperators,
  standardTypes,
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
  // Import the lints only dynamically here: they stay a lazy chunk (QA-01, F-112).
  loadLints: async () => (await import("./lints/index.ts")).lints,
  // Import the generated templates JSON only dynamically here: the pack stays erasable under plain Node, and the templates stay a lazy chunk (F-203).
  loadTemplates: async () =>
    (await import("../templates.json")).default as TemplateSet,
  // The rules read the config catalogue, so they stay a lazy chunk too (F-601); the promise is kept.
  loadConfigRules: (catalogue?: ConfigCatalogue) => {
    if (catalogue)
      return import("./config/index.ts").then((rules) =>
        rules.createConfigRules(catalogue),
      );
    configRules ??= Promise.all([
      import("./config/index.ts"),
      import("../catalogue/config.json"),
    ]).then(([rules, config]) =>
      rules.createConfigRules(config.default as ConfigCatalogue),
    );
    return configRules;
  },
};
