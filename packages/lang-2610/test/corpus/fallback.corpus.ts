// F-104 step 2 (ADR 0004, IO-14): the pre-scanner on real code. On every file of the pinned corpus, forcing the chunk
// path splits the file into chunks that parse alone and stitch back into the whole-file AST; every chunk's head names
// the declaration the AST has; and cutting a file keeps the earlier declarations. Run by `pnpm test:corpus` after
// `pnpm corpus:fetch`. Reads .cache/ by path; imports nothing from tools/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigChunks,
  parseScriptChunks,
} from "../../src/source/parse-source.ts";
import { prescan } from "../../src/source/prescan.ts";
import { assertCut, cutSet, topItems } from "../source/cuts.ts";
import { labelOf } from "../source/labels.ts";
import { listSources } from "./corpus-files.ts";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const pinned = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

const files = pinned.flatMap((id) => {
  const dir = join(CORPUS, id);
  return existsSync(dir)
    ? listSources(dir).map((s) => ({
        id,
        ...s,
        text: readFileSync(join(dir, s.path), "utf8"),
      }))
    : [];
});

const SAREK_SAMPLE = 20;
const cutFiles = pinned.flatMap((id) => {
  const mine = files.filter((f) => f.id === id);
  if (id !== "sarek" && id !== "rnaseq") return mine;
  if (id === "rnaseq") return [];
  const step = Math.max(1, Math.floor(mine.length / SAREK_SAMPLE));
  return mine.filter((_, i) => i % step === 0).slice(0, SAREK_SAMPLE);
});

describe("F-104 step 2 IO-14: the pre-scanner on the pinned corpus", () => {
  it("F-104 step 2: the corpus is present", () => {
    expect(pinned.length).toBeGreaterThanOrEqual(5);
    expect(files.length, "run pnpm corpus:fetch first").toBeGreaterThan(500);
  });

  it("F-104 step 2: the pre-scanner splits every corpus file into chunks that parse alone and stitch back into the whole-file AST", () => {
    let scripts = 0;
    let configs = 0;
    const failures: string[] = [];
    for (const f of files) {
      const config = f.kind === "config";
      const whole = config ? parseConfigAst(f.text) : parseScriptAst(f.text);
      if (!whole.ok) {
        failures.push(`${f.id}/${f.path}: does not parse whole`);
        continue;
      }
      const chunked = config
        ? parseConfigChunks(f.text)
        : parseScriptChunks(f.text);
      if (config) configs++;
      else scripts++;
      let same = chunked.status === "modelled";
      if (same) {
        try {
          expect(chunked.ast).toEqual(whole.ast);
        } catch {
          same = false;
        }
      }
      if (!same) failures.push(`${f.id}/${f.path}: ${chunked.status}`);
    }
    expect(failures).toEqual([]);
    console.log(`chunk path: ${scripts} scripts, ${configs} configs stitched`);
  });

  it("F-104 step 2: the pre-scanner names every corpus declaration as the AST does", () => {
    const failures: string[] = [];
    let named = 0;
    for (const f of files) {
      const config = f.kind === "config";
      const whole = config ? parseConfigAst(f.text) : parseScriptAst(f.text);
      if (!whole.ok) continue;
      const items = topItems(whole.ast);
      for (const chunk of prescan(f.text, config ? "config" : "script")
        .chunks) {
        const first = items.find(
          (i) => i.range.start >= chunk.start && i.range.start < chunk.end,
        );
        if (!first) continue;
        const want = labelOf(first, f.text);
        const got = chunk.head
          ? `${chunk.head.keyword} ${chunk.head.name ?? ""}`.trim()
          : "statement";
        named++;
        if (got !== want)
          failures.push(`${f.id}/${f.path}@${chunk.start}: ${got} vs ${want}`);
      }
    }
    expect(failures).toEqual([]);
    console.log(`${named} chunk heads agree with the AST`);
  });

  it("F-104 IO-14 step 2: cutting corpus files keeps earlier declarations modelled", () => {
    let cuts = 0;
    for (const f of cutFiles) {
      const set = cutSet(f.text, f.kind === "config", 5);
      for (const cut of [...set.cuts].filter(
        (_, i) => i % Math.max(1, Math.floor(set.cuts.length / 5)) === 0,
      )) {
        assertCut(set, cut, `${f.id}/${f.path}`);
        cuts++;
      }
    }
    expect(cuts).toBeGreaterThan(100);
    console.log(`${cutFiles.length} files, ${cuts} cuts`);
  });
});
