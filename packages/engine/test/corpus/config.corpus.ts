// F-601 (FI-01, FI-03, FI-06, AR-22, AR-23, AR-30): the config view and the config edit commands over every pinned
// corpus pipeline. Run by `pnpm test:corpus` after `pnpm corpus:fetch`; writes .cache/reports/config-corpus.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigAst, ConfigSourceFile } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { ConfigViewItem, ScopeCard } from "../../src/config/types";
import { EXCERPT_LIMIT } from "../../src/config/types";
import type { Opened } from "../config/helpers";
import { open } from "../config/helpers";
import { readTree } from "../model/read-tree";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

const opened = new Map<string, Opened>();
const report: string[] = [];
const zeroMatches: string[] = [];
let configs = 0;

beforeAll(async () => {
  for (const id of IDS) opened.set(id, await open(readTree(join(CORPUS, id))));
});

const configPaths = (o: Opened): string[] =>
  o.model.paths().filter((p) => o.model.file(p)?.source.language === "config");

/** Every excerpt the view carries. */
function excerpts(items: readonly ConfigViewItem[], out: string[] = []) {
  for (const item of items) {
    if (item.kind === "code") out.push(item.text);
    else if (item.kind === "include") out.push(item.source);
    else {
      const card = item.card;
      for (const r of [
        ...card.rows,
        ...card.selectors.flatMap((s) => s.rows),
      ]) {
        if (r.kind === "option" && r.code !== null) out.push(r.code);
        else if (r.kind === "code") out.push(r.text);
        else if (r.kind === "include") out.push(r.source);
      }
      for (const p of card.profiles) excerpts(p.items, out);
    }
  }
  return out;
}

const cardsOf = (items: readonly ConfigViewItem[]): ScopeCard[] =>
  items.flatMap((i) => (i.kind === "scope" ? [i.card] : []));

describe("F-601 config view corpus", () => {
  it("F-601 FI-01 AR-30: configView never throws on the corpus configs, accounts for every statement and keeps excerpts short", () => {
    for (const [id, o] of opened)
      for (const path of configPaths(o)) {
        const source = o.model.file(path)?.source as ConfigSourceFile;
        const view = o.view(path);
        configs += 1;
        expect(view.path).toBe(path);
        expect(view.editable).toBe(
          source.status === "modelled" && source.problems.length === 0,
        );
        for (const s of (source.ast as ConfigAst | null)?.statements ?? [])
          expect(
            view.items.some(
              (i) =>
                (i.kind === "scope" ? i.card.range : i.range).start <=
                  s.range.start &&
                (i.kind === "scope" ? i.card.range : i.range).end >=
                  s.range.end,
            ),
            `${id}/${path}: statement at ${s.range.line} is in the view`,
          ).toBe(true);
        for (const e of excerpts(view.items)) {
          expect(e.length).toBeLessThanOrEqual(EXCERPT_LIMIT);
          expect(e).not.toMatch(/[\r\n]/);
        }
      }
    expect(configs).toBeGreaterThan(100);
  });

  it("F-601 FI-03: on the five pins the unknown-option warnings are exactly the eight plugin-scope options", () => {
    const found: string[] = [];
    for (const o of opened.values())
      for (const d of o.diagnoser.all())
        if (d.code === "config-unknown-option")
          found.push(
            /Unrecognized config option '([^']+)'/.exec(d.message)?.[1] ??
              d.message,
          );
    const scopes = found.map((n) => n.split(".")[0]).sort();
    expect(found).toHaveLength(8);
    expect(scopes.filter((s) => s === "validation")).toHaveLength(6);
    expect(scopes.filter((s) => s === "prov")).toHaveLength(2);
    report.push(`Unknown-option warnings: ${found.sort().join(", ")}`);
  });

  it("F-601 FI-06: selector counts on the pins; zero matches are listed in the report", () => {
    let selectors = 0;
    for (const [id, o] of opened)
      for (const path of configPaths(o)) {
        const walk = (items: readonly ConfigViewItem[]) => {
          for (const card of cardsOf(items)) {
            for (const s of card.selectors) {
              if (s.match === null) continue;
              selectors += 1;
              if (s.match.count === 0)
                zeroMatches.push(`${id}/${path}: ${s.written}`);
              else expect(s.match.count).toBeGreaterThan(0);
            }
            for (const p of card.profiles) walk(p.items);
          }
        };
        walk(o.view(path).items);
      }
    expect(selectors).toBeGreaterThan(0);
    report.push(`Selectors evaluated: ${selectors}`);
  });

  it("F-601: the config corpus report is written", () => {
    mkdirSync(REPORTS, { recursive: true });
    const lines = [
      "# Config editor over the corpus (F-601)",
      "",
      `Config files viewed: ${configs}.`,
      "",
      ...report.map((l) => `- ${l}`),
      "",
      `Selectors matching no process (${zeroMatches.length}):`,
      "",
      ...zeroMatches.map((l) => `- ${l}`),
    ];
    writeFileSync(join(REPORTS, "config-corpus.md"), `${lines.join("\n")}\n`);
    expect(lines.length).toBeGreaterThan(4);
  });
});
