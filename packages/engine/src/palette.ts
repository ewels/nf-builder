import type { LanguagePack, PaletteView } from "@nf-builder/lang-core";
import { installedPacks } from "./packs";
import { resolvePaletteView } from "./palette-view";

const views = new WeakMap<LanguagePack, Promise<PaletteView>>();

/** The resolved palette of the installed pack for `version`. Memoised per pack; a rejected load is forgotten so the next call retries. */
export function loadPalette(
  version: string,
  packs: readonly LanguagePack[] = installedPacks,
): Promise<PaletteView> {
  const pack = packs.find((p) => p.version === version);
  if (!pack)
    return Promise.reject(new Error(`No language pack for ${version}`));
  let view = views.get(pack);
  if (!view) {
    view = pack
      .loadCatalogue()
      .then((catalogue) =>
        resolvePaletteView(pack.version, pack.palette, catalogue),
      );
    views.set(pack, view);
    view.catch(() => {
      if (views.get(pack) === view) views.delete(pack);
    });
  }
  return view;
}
