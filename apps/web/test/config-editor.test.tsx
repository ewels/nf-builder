import type {
  ConfigRow,
  ConfigView,
  OptionRow,
  ScopeCard,
  SelectorCard,
} from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConfigEditorView,
  READ_ONLY_BANNER,
} from "../src/config/config-editor";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const opt = (label: string, over: Partial<OptionRow> = {}): OptionRow => ({
  kind: "option",
  key: `row:${label}`,
  option: ["process", label],
  label,
  class: "option",
  types: ["String"],
  valueKind: "string",
  value: { kind: "string", value: "x" },
  code: null,
  occurrences: 1,
  range,
  nameRange: range,
  diagnostics: [],
  ...over,
});
const card = (scope: string, over: Partial<ScopeCard> = {}): ScopeCard => ({
  key: `scope:/:${scope}`,
  scope,
  known: true,
  form: "generic",
  pinned: [],
  rows: [],
  selectors: [],
  profiles: [],
  plugins: [],
  range,
  ...over,
});
const sel = (
  written: string,
  count: number | null,
  over: Partial<SelectorCard> = {},
): SelectorCard => ({
  key: `sel:${written}`,
  selector: { kind: "withLabel", pattern: written },
  written: `withLabel: ${written}`,
  range,
  rows: [],
  match: { count, processes: [], note: null },
  ...over,
});
const viewOf = (
  items: ConfigView["items"],
  over: Partial<ConfigView> = {},
): ConfigView => ({
  path: "nextflow.config",
  status: "modelled",
  editable: true,
  context: { profile: null, selector: null },
  items,
  ...over,
});
const html = (
  view: ConfigView,
  over: Partial<Parameters<typeof ConfigEditorView>[0]> = {},
) =>
  renderToStaticMarkup(
    <ConfigEditorView
      view={view}
      toggled={[]}
      selected={null}
      onSelect={() => undefined}
      onToggle={() => undefined}
      onOpen={() => undefined}
      {...over}
    />,
  );

describe("F-601 config editor", () => {
  it("F-601 FI-01: each top-level scope is a collapsible card in source order", () => {
    const out = html(
      viewOf([
        { kind: "scope", card: card("manifest") },
        { kind: "scope", card: card("process") },
        { kind: "scope", card: card("docker") },
      ]),
    );
    const names = [...out.matchAll(/<h3[^>]*><button[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(names).toEqual(["manifest", "process", "docker"]);
    expect(out).toContain('aria-expanded="true"');
    const closed = html(viewOf([{ kind: "scope", card: card("process") }]), {
      toggled: ["scope:/:process"],
    });
    expect(closed).toContain('aria-expanded="false"');
  });

  it("F-601 FI-02: first-class cards show their pinned fields, set or not; generic cards show the options that are set", () => {
    const out = html(
      viewOf([
        {
          kind: "scope",
          card: card("process", {
            form: "process",
            pinned: ["cpus", "memory"],
            rows: [
              opt("memory", {
                value: { kind: "memory", amount: 8, unit: "GB" },
                valueKind: "memory",
              }),
            ],
          }),
        },
        {
          kind: "scope",
          card: card("wave", { rows: [opt("strategy")] }),
        },
      ]),
    );
    expect(out).toContain('data-option="cpus"');
    expect(out).toContain("Not set");
    expect(out).toContain("8.GB");
    expect(out).toContain('data-option="strategy"');
  });

  it("F-601 FI-03 QA-12: an unknown option shows Unknown option with the glyph and its value as code", () => {
    const out = html(
      viewOf([
        {
          kind: "scope",
          card: card("process", {
            rows: [
              opt("memmory", {
                class: "unknown",
                value: null,
                code: "'4 GB'",
                valueKind: "code",
              }),
            ],
          }),
        },
      ]),
    );
    expect(out).toContain("Unknown option");
    expect(out).toContain("▲");
    expect(out).toContain("&#x27;4 GB&#x27;");
  });

  it("F-601 FI-06: selector cards read used by 1 process, used by no process or Can't evaluate this pattern", () => {
    const out = html(
      viewOf([
        {
          kind: "scope",
          card: card("process", {
            form: "process",
            selectors: [sel("a", 1), sel("b", 0), sel("c", null), sel("d", 3)],
          }),
        },
      ]),
    );
    expect(out).toContain("used by 1 process<");
    expect(out).toContain("used by no process");
    expect(out).toContain("Can&#x27;t evaluate this pattern");
    expect(out).toContain("used by 3 processes");
    expect(out).toContain("withLabel: a");
  });

  it("F-601 FI-06: a process card with more than 20 selectors shows each collapsed to its summary line", () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      sel(`l${i}`, 1, { rows: [opt("memory")] }),
    );
    const out = html(
      viewOf([
        {
          kind: "scope",
          card: card("process", { form: "process", selectors: many }),
        },
      ]),
    );
    expect(out).toContain("withLabel: l0");
    expect(out).not.toContain('data-option="memory"');
    const open = html(
      viewOf([
        {
          kind: "scope",
          card: card("process", { form: "process", selectors: many }),
        },
      ]),
      { toggled: ["sel:l0"] },
    );
    expect(open).toContain('data-option="memory"');
    const few = html(
      viewOf([
        {
          kind: "scope",
          card: card("process", {
            form: "process",
            selectors: many.slice(0, 20),
          }),
        },
      ]),
    );
    expect(few).toContain('data-option="memory"');
  });

  it("F-601 FI-05: an include row links its file; a missing one says why; an external one doesn't link", () => {
    const rows: ConfigRow[] = [
      {
        kind: "include",
        key: "include:1",
        range,
        source: "'conf/extra.config'",
        target: { kind: "file", path: "conf/extra.config" },
      },
      {
        kind: "include",
        key: "include:2",
        range,
        source: "'nope.config'",
        target: { kind: "missing", message: "nope.config doesn't exist" },
      },
      {
        kind: "include",
        key: "include:3",
        range,
        source: "params.cfg",
        target: { kind: "external" },
      },
    ];
    const out = html(viewOf(rows as unknown as ConfigView["items"]));
    expect(out).toContain("Open conf/extra.config");
    expect(out).toContain("nope.config doesn&#x27;t exist");
    expect(out).toContain("External source, not checked");
    expect(out.match(/Open /g)).toHaveLength(1);
  });

  it("F-601: a view that isn't editable shows the banner; the rows are read-only either way for now", () => {
    const banner = html(
      viewOf(
        [{ kind: "scope", card: card("process", { rows: [opt("cpus")] }) }],
        {
          editable: false,
        },
      ),
    );
    expect(banner).toContain(READ_ONLY_BANNER);
    expect(READ_ONLY_BANNER).toBe(
      "This file has errors. Fix them in Code; the form is read-only until then.",
    );
    expect(
      html(viewOf([{ kind: "scope", card: card("process") }])),
    ).not.toContain(READ_ONLY_BANNER);
  });

  it("F-601 FI-01: profiles hold nested cards, and plugins list their ids", () => {
    const out = html(
      viewOf([
        {
          kind: "scope",
          card: card("profiles", {
            form: "profiles",
            profiles: [
              {
                key: "profile:/:test",
                name: "test",
                range,
                items: [
                  {
                    kind: "scope",
                    card: card("docker", { key: "scope:/test:docker" }),
                  },
                ],
              },
            ],
          }),
        },
        {
          kind: "scope",
          card: card("plugins", {
            form: "plugins",
            plugins: [
              {
                key: "plugin:1",
                id: "nf-schema@2.5.1",
                name: "nf-schema",
                version: "2.5.1",
                range,
              },
            ],
          }),
        },
      ]),
    );
    expect(out).toContain("test");
    expect(out).toContain("docker");
    expect(out).toContain("nf-schema");
    expect(out).toContain("2.5.1");
  });
});
