import type { ConfigAst, ScriptAst } from "@nf-builder/lang-core";
import { expect } from "vitest";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";
import { type Chunk, prescan } from "../../src/source/prescan.ts";
import { checkTiling } from "./tiling.ts";

export const topItems = (ast: ScriptAst | ConfigAst) =>
  ast.kind === "Script" ? ast.body : ast.statements;

export interface CutSet {
  readonly text: string;
  readonly config: boolean;
  readonly whole: ReturnType<typeof parseScriptAst>;
  readonly chunks: readonly Chunk[];
  readonly cuts: readonly number[];
}

/** The cut points of F-104's truncation property: every chunk start and its neighbours, plus `random` seeded offsets. */
export function cutSet(
  text: string,
  config: boolean,
  random: number,
  seed = 7,
): CutSet {
  const whole = config ? parseConfigAst(text) : parseScriptAst(text);
  const chunks = prescan(text, config ? "config" : "script").chunks;
  const cuts = new Set<number>();
  for (const c of chunks)
    for (const d of [-1, 0, 1])
      cuts.add(Math.max(0, Math.min(text.length, c.start + d)));
  let s = seed;
  for (let i = 0; i < random; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    cuts.add(s % (text.length + 1));
  }
  return { text, config, whole: whole as never, chunks, cuts: [...cuts] };
}

/**
 * Parsing the prefix up to `cut` never throws and loses no text; every item of the whole-file parse that lies in the
 * chunks before the one holding the cut is still modelled and unchanged.
 */
export function assertCut(set: CutSet, cut: number, label = ""): void {
  const { text, config, whole, chunks } = set;
  const prefix = text.slice(0, cut);
  const r = config ? parseConfigSource(prefix) : parseScriptSource(prefix);
  const where = `${label} cut ${cut}`;
  if (r.ast) expect(checkTiling(prefix, r.ast), where).toEqual([]);
  if (!whole.ok || whole.errors.length > 0) return;
  const holder = chunks.findIndex((c) => cut >= c.start && cut < c.end);
  const firstHeld = holder < 0 ? text.length : (chunks[holder]?.start ?? 0);
  const keep = topItems(whole.ast).filter((i) => i.range.end <= firstHeld);
  const got = r.ast ? topItems(r.ast) : [];
  expect(got.slice(0, keep.length), where).toEqual(keep);
}
