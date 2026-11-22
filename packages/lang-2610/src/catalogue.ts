// The generated 26.10 catalogue (ADR 0005, ADR 0020), typed with the lang-core contract. Not exported from
// index.ts yet: the palette and inspector features (F-109, F-204) pick it up.
import type { ConfigCatalogue, ScriptCatalogue } from "@nf-builder/lang-core";
import config from "../catalogue/config.json" with { type: "json" };
import script from "../catalogue/script.json" with { type: "json" };

export const scriptCatalogue: ScriptCatalogue = script as ScriptCatalogue;
export const configCatalogue: ConfigCatalogue = config as ConfigCatalogue;
