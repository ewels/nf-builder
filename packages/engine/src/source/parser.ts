import { perPack } from "../packs";

/** The parser of the installed pack for a version (`LanguagePack.loadParser`), memoised per pack. */
export const loadParser = perPack((pack) => pack.loadParser());
