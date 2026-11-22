// The node the F-104 fallback builds for text a pack could not model (ADR 0004). The AST builders never make it.
import type { ParseProblem } from "./parse-result.ts";
import type { NodeBase } from "./range.ts";

/** What the pre-scanner recognised at the start of a top-level item. */
export interface DeclarationHead {
  /**
   * Scripts: featureFlag, include, import, params, param, record, enum, agent, process, workflow, output, function.
   * Configs: assign, block, includeConfig, invalid.
   */
  readonly keyword: string;
  /** "SECOND", "nextflow.enable.types", "docker.enabled", "profiles"; null for an entry workflow, params/output blocks, includes. */
  readonly name: string | null;
}

/** A top-level declaration or statement the pack could not model, kept as its exact text (ADR 0004). */
export interface Unparsed extends NodeBase<"Unparsed"> {
  /** Exact source text: `text.slice(range.start, range.end)`. */
  readonly text: string;
  readonly head: DeclarationHead | null;
  /** Why: the chunk's parse errors, or the builder errors inside the item. */
  readonly problems: readonly ParseProblem[];
}
