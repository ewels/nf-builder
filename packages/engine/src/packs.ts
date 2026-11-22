import { pack as pack2610 } from "@nf-builder/lang-2610";
import type { LanguagePack } from "@nf-builder/lang-core";

export const installedPacks: readonly LanguagePack[] = [pack2610];

export function installedPackVersions(): readonly string[] {
  return installedPacks.map((pack) => pack.version);
}
