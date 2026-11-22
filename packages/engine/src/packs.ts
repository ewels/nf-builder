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
