// The generated 26.10 catalogue (ADR 0005, ADR 0020), typed with the lang-core contract. The pack's
// `loadCatalogue()` imports the same JSON files dynamically (ADR 0028); this typed view is for tests and tools.
import type { ConfigCatalogue, ScriptCatalogue } from "@nf-builder/lang-core";
import config from "../catalogue/config.json" with { type: "json" };
import script from "../catalogue/script.json" with { type: "json" };

export const scriptCatalogue = script as ScriptCatalogue;
export const configCatalogue = config as ConfigCatalogue;
