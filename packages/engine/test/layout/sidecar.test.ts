import type { NodeKey, NodeKeyLocal } from "@nf-builder/lang-core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EMPTY_LAYOUT,
  formatLayout,
  LAYOUT_MIGRATIONS,
  LAYOUT_VERSION,
  type LayoutDocument,
  parseLayout,
  trackedWorkflows,
  workflowPositions,
  writePositions,
} from "../../src/layout";
import { formatNodeKey } from "../../src/projection/keys";

const doc = (nodes: LayoutDocument["nodes"]): LayoutDocument => ({
  version: 1,
  nodes,
});

describe("F-207 sidecar", () => {
  it("F-207 IO-02 ADR-0008: formatLayout writes version 1, sorted keys one per line, integer coordinates and a trailing newline; parseLayout reads it back", () => {
    const text = formatLayout(
      doc({
        "main.nf#/reads": { x: 12.4, y: 12.6 },
        "main.nf#/COUNT@1": { x: 272, y: 40 },
      }),
    );
    expect(text).toBe(
      [
        "{",
        '  "version": 1,',
        '  "nodes": {',
        '    "main.nf#/COUNT@1": { "x": 272, "y": 40 },',
        '    "main.nf#/reads": { "x": 12, "y": 13 }',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(formatLayout(EMPTY_LAYOUT)).toBe(
      '{\n  "version": 1,\n  "nodes": {}\n}\n',
    );
    const parsed = parseLayout(text);
    expect(parsed).toEqual({
      ok: true,
      dropped: 0,
      document: doc({
        "main.nf#/COUNT@1": { x: 272, y: 40 },
        "main.nf#/reads": { x: 12, y: 13 },
      }),
    });
    expect(
      formatLayout((parsed as { document: LayoutDocument }).document),
    ).toBe(text);
  });

  it("F-207 IO-02 ADR-0036: format and parse round-trip any node keys and positions", () => {
    const ident = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_.]{0,8}$/);
    const local: fc.Arbitrary<NodeKeyLocal> = fc.oneof(
      fc.record({
        kind: fc.constant("assigned" as const),
        variable: ident,
        occurrence: fc.integer({ min: 1, max: 9 }),
      }),
      fc.record({
        kind: fc.constant("unassigned" as const),
        callee: ident,
        occurrence: fc.integer({ min: 1, max: 9 }),
      }),
      fc.record({
        kind: fc.constant("code" as const),
        occurrence: fc.integer({ min: 1, max: 9 }),
      }),
      fc.record({
        kind: fc.constantFrom("take" as const, "emit" as const),
        name: ident,
      }),
      fc.constant({ kind: "params" as const }),
      fc.constant({ kind: "output" as const }),
    );
    const key: fc.Arbitrary<NodeKey> = fc.record({
      path: fc.stringMatching(/^[a-z][a-z0-9/_#.-]{0,12}\.nf$/),
      workflow: fc.option(ident, { nil: null }),
      local,
    });
    const point = fc.record({
      x: fc.integer({ min: -1_000_000, max: 1_000_000 }),
      y: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(key, point), { maxLength: 12 }),
        (entries) => {
          const nodes = Object.fromEntries(
            entries.map(([k, p]) => [formatNodeKey(k), p]),
          );
          const text = formatLayout(doc(nodes));
          const parsed = parseLayout(text);
          expect(parsed).toEqual({
            ok: true,
            dropped: 0,
            document: doc(nodes),
          });
          expect(
            formatLayout((parsed as { document: LayoutDocument }).document),
          ).toBe(text);
        },
      ),
      { seed: 207 },
    );
  });

  it("F-207 IO-02: invalid JSON, a wrong shape and a missing or zero version are invalid; a higher version is newer; nothing throws", () => {
    for (const text of [
      "",
      "{",
      "null",
      "[]",
      "3",
      '"x"',
      "{}",
      '{"nodes":{}}',
      '{"version":0,"nodes":{}}',
      '{"version":-1,"nodes":{}}',
      '{"version":1.5,"nodes":{}}',
      '{"version":"1","nodes":{}}',
      '{"version":1}',
      '{"version":1,"nodes":[]}',
      '{"version":1,"nodes":null}',
    ]) {
      const parsed = parseLayout(text);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) {
        expect(parsed.state, text).toBe("invalid");
        expect(parsed.message.length).toBeGreaterThan(0);
      }
    }
    const newer = parseLayout('{"version":2,"nodes":{"anything":1}}');
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.state).toBe("newer");
  });

  it("F-207 IO-02: entries with unparseable keys or non-finite or out-of-range coordinates are dropped and counted", () => {
    const parsed = parseLayout(
      JSON.stringify({
        version: 1,
        extra: "ignored",
        nodes: {
          "main.nf#/ok": { x: 1, y: 2, other: true },
          "no-hash": { x: 1, y: 2 },
          "main.nf#/bad@0": { x: 1, y: 2 },
          "main.nf#/far": { x: 1_000_001, y: 0 },
          "main.nf#/negfar": { x: 0, y: -1_000_001 },
          "main.nf#/str": { x: "1", y: 2 },
          "main.nf#/missing": { x: 1 },
          "main.nf#/null": null,
          "main.nf#/array": [1, 2],
          "main.nf#/edge": { x: 1_000_000, y: -1_000_000 },
        },
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      dropped: 8,
      document: doc({
        "main.nf#/ok": { x: 1, y: 2 },
        "main.nf#/edge": { x: 1_000_000, y: -1_000_000 },
      }),
    });
    // JSON can't carry NaN or Infinity; a number too large for a double parses to Infinity
    const huge = parseLayout(
      '{"version":1,"nodes":{"a.nf#/x":{"x":1e999,"y":0}}}',
    );
    expect(huge).toMatchObject({ ok: true, dropped: 1 });
  });

  it("F-207 IO-02: the target version is LAYOUT_VERSION unless a test passes one, and the shipped table covers every older version", () => {
    for (let v = 1; v < LAYOUT_VERSION; v++)
      expect(LAYOUT_MIGRATIONS[v], `migration from ${v}`).toBeTypeOf(
        "function",
      );
    // a table with a migration doesn't move the target: a file above LAYOUT_VERSION is newer
    const migrations = {
      [LAYOUT_VERSION]: (raw: Record<string, unknown>) => raw,
    };
    expect(
      parseLayout(`{"version":${LAYOUT_VERSION + 1},"nodes":{}}`, migrations),
    ).toMatchObject({ ok: false, state: "newer" });
  });

  it("F-207 IO-02: migrations run in order from the file's version up to the target, and a save writes the build's own version", () => {
    const calls: number[] = [];
    const migrations = {
      1: (raw: Record<string, unknown>) => {
        calls.push(1);
        const nodes = raw.nodes as Record<
          string,
          { left: number; top: number }
        >;
        return {
          ...raw,
          version: 2,
          nodes: Object.fromEntries(
            Object.entries(nodes).map(([k, v]) => [k, { x: v.left, y: v.top }]),
          ),
        };
      },
      2: (raw: Record<string, unknown>) => {
        calls.push(2);
        const nodes = raw.nodes as Record<string, { x: number; y: number }>;
        return {
          ...raw,
          version: 3,
          nodes: Object.fromEntries(
            Object.entries(nodes).map(([k, v]) => [k, { x: v.x * 2, y: v.y }]),
          ),
        };
      },
    };
    const parsed = parseLayout(
      '{"version":1,"nodes":{"main.nf#/a":{"left":3,"top":4}}}',
      migrations,
      3,
    );
    expect(calls).toEqual([1, 2]);
    expect(parsed).toMatchObject({
      ok: true,
      document: { nodes: { "main.nf#/a": { x: 6, y: 4 } } },
    });
    // a file already at the target version runs none, and the shipped table is empty
    calls.length = 0;
    parseLayout('{"version":3,"nodes":{}}', migrations, 3);
    expect(calls).toEqual([]);
    // the shipped table is empty and its target is LAYOUT_VERSION, so a version in between has no migration
    expect(parseLayout('{"version":0,"nodes":{}}').ok).toBe(false);
    // the target here is a stand-in: a save always writes the version this build knows
    expect(
      formatLayout((parsed as { document: LayoutDocument }).document),
    ).toContain(`"version": ${LAYOUT_VERSION},`);
  });

  it("F-207 ADR-0008: writePositions merges, or replaces only the given workflow's entries", () => {
    const base = doc({
      "main.nf#/a": { x: 1, y: 1 },
      "main.nf#/b": { x: 2, y: 2 },
      "main.nf#W/c": { x: 3, y: 3 },
      "other.nf#/a": { x: 4, y: 4 },
    });
    const merged = writePositions(base, {
      path: "main.nf",
      workflow: null,
      positions: {
        "main.nf#/b": { x: 20.4, y: 20 },
        "main.nf#/d": { x: 5, y: 5 },
      },
      replace: false,
    });
    expect(merged.nodes).toEqual({
      "main.nf#/a": { x: 1, y: 1 },
      "main.nf#/b": { x: 20, y: 20 },
      "main.nf#/d": { x: 5, y: 5 },
      "main.nf#W/c": { x: 3, y: 3 },
      "other.nf#/a": { x: 4, y: 4 },
    });
    const replaced = writePositions(base, {
      path: "main.nf",
      workflow: null,
      positions: { "main.nf#/d": { x: 5, y: 5 } },
      replace: true,
    });
    expect(replaced.nodes).toEqual({
      "main.nf#/d": { x: 5, y: 5 },
      "main.nf#W/c": { x: 3, y: 3 },
      "other.nf#/a": { x: 4, y: 4 },
    });
    expect(base.nodes["main.nf#/b"]).toEqual({ x: 2, y: 2 });
    expect(workflowPositions(base, "main.nf", null)).toEqual({
      "main.nf#/a": { x: 1, y: 1 },
      "main.nf#/b": { x: 2, y: 2 },
    });
    expect(
      workflowPositions(base, "main.nf", null, ["main.nf#/b", "main.nf#/zzz"]),
    ).toEqual({ "main.nf#/b": { x: 2, y: 2 } });
    expect(trackedWorkflows(base)).toEqual([
      { path: "main.nf", workflow: null },
      { path: "main.nf", workflow: "W" },
      { path: "other.nf", workflow: null },
    ]);
  });
});
