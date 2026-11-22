import { perPack } from "../packs";

/** The lints of the installed pack for a version (`LanguagePack.loadLints`), memoised per pack. */
export const loadLints = /* @__PURE__ */ perPack((pack) => pack.loadLints());
