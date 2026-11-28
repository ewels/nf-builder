// Which processes a selector matches, as nextflow's `ConfigSelectorResolver` decides (F-601, FI-06;
// modules/nextflow/src/main/groovy/nextflow/config/ConfigSelectorResolver.groovy L89-L116, Apache-2.0).
import type { ConfigSelectorRef } from "@nf-builder/lang-core";
import type { ProcessUses, SelectorMatch } from "./types";

/** A key of a config block or dotted path that names a selector (`withName:FOO`). */
export const isSelectorKey = (name: string): boolean =>
  name.startsWith("withName:") || name.startsWith("withLabel:");

const DETAIL_LIMIT = 50;

/** The pattern without a leading `!` (after trimming), and whether it was negated. */
function parse(pattern: string): { source: string; negate: boolean } {
  const trimmed = pattern.trim();
  if (trimmed.startsWith("!"))
    return { source: trimmed.slice(1).trim(), negate: true };
  return { source: trimmed, negate: false };
}

export function matchSelector(
  selector: ConfigSelectorRef,
  uses: ProcessUses,
): SelectorMatch {
  const { source, negate } = parse(selector.pattern);
  let regex: RegExp;
  try {
    regex = new RegExp(`^(?:${source})$`);
  } catch {
    return { count: null, processes: [], note: "Can't evaluate this pattern" };
  }
  const matched = new Set<string>();
  for (const use of uses.uses) {
    const hit =
      selector.kind === "withLabel"
        ? use.labels.some((label) => regex.test(label))
        : [...new Set([use.base, use.simple, use.fq])].some((name) =>
            regex.test(name),
          );
    if (hit !== negate) matched.add(use.fq);
  }
  return {
    count: matched.size,
    processes: [...matched].slice(0, DETAIL_LIMIT),
    note: null,
  };
}
