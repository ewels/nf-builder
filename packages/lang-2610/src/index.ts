import type { LanguagePack } from "@nf-builder/lang-core";

export const pack: LanguagePack = { version: "26.10" };
export type { ParseError, ParseOutcome } from "./parser/parse.ts";
export { parseConfig, parseScript } from "./parser/parse.ts";
