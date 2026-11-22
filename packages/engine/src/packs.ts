import {
  pack as pack2610,
  version as version2610,
} from "@nf-builder/lang-2610";
import type { LanguagePack } from "@nf-builder/lang-core";

export const installedPacks: readonly LanguagePack[] = [pack2610];

/** Read from the packs' pack-free `version` exports, so the main build holds no pack (F-113). */
export function installedPackVersions(): readonly string[] {
  return [version2610];
}

/**
 * `load` for the installed pack of a version, memoised per pack; a rejected load is forgotten so the next call retries.
 * The loaders `loadParser`, `loadLints` and `loadPalette` are built with it.
 */
export function perPack<T>(load: (pack: LanguagePack) => Promise<T>) {
  const loaded = new WeakMap<LanguagePack, Promise<T>>();
  return (
    version: string,
    packs: readonly LanguagePack[] = installedPacks,
  ): Promise<T> => {
    const pack = packs.find((p) => p.version === version);
    if (!pack)
      return Promise.reject(new Error(`No language pack for ${version}`));
    let result = loaded.get(pack);
    if (!result) {
      result = load(pack);
      loaded.set(pack, result);
      result.catch(() => loaded.delete(pack));
    }
    return result;
  };
}
