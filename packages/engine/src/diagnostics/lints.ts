import type { LanguagePack, PackLints } from "@nf-builder/lang-core";
import { installedPacks } from "../packs";

const loaded = new WeakMap<LanguagePack, Promise<PackLints>>();

/** The lints of the installed pack for `version`. Memoised per pack; a rejected load is forgotten so the next call retries. */
export function loadLints(
  version: string,
  packs: readonly LanguagePack[] = installedPacks,
): Promise<PackLints> {
  const pack = packs.find((p) => p.version === version);
  if (!pack)
    return Promise.reject(new Error(`No language pack for ${version}`));
  let lints = loaded.get(pack);
  if (!lints) {
    lints = pack.loadLints();
    loaded.set(pack, lints);
    lints.catch(() => loaded.delete(pack));
  }
  return lints;
}
