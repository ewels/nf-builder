import type { LanguagePack, SourceParser } from "@nf-builder/lang-core";
import { installedPacks } from "../packs";

const parsers = new WeakMap<LanguagePack, Promise<SourceParser>>();

/** The parser of the installed pack for `version`. Memoised per pack; a rejected load is forgotten so the next call retries. */
export function loadParser(
  version: string,
  packs: readonly LanguagePack[] = installedPacks,
): Promise<SourceParser> {
  const pack = packs.find((p) => p.version === version);
  if (!pack)
    return Promise.reject(new Error(`No language pack for ${version}`));
  let parser = parsers.get(pack);
  if (!parser) {
    parser = pack.loadParser();
    parsers.set(pack, parser);
    parser.catch(() => parsers.delete(pack));
  }
  return parser;
}
