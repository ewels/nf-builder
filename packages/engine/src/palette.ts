import { perPack } from "./packs";
import { resolvePaletteView } from "./palette-view";

/** The resolved palette of the installed pack for a version, memoised per pack. */
export const loadPalette = /* @__PURE__ */ perPack((pack) =>
  pack
    .loadCatalogue()
    .then((catalogue) =>
      resolvePaletteView(pack.version, pack.palette, catalogue),
    ),
);
