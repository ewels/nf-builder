import type {
  ConfigSchemaNode,
  OptionRow,
  ScopeCard,
  SelectorCard,
} from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConfigDetailsView,
  findSchemaNode,
  findTarget,
} from "../src/config/config-details";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const row = (over: Partial<OptionRow> = {}): OptionRow => ({
  kind: "option",
  key: "row:1",
  option: ["process", "memory"],
  label: "memory",
  class: "option",
  types: ["MemoryUnit"],
  valueKind: "memory",
  value: { kind: "memory", amount: 8, unit: "GB" },
  code: null,
  occurrences: 1,
  range,
  nameRange: range,
  diagnostics: [],
  ...over,
});
const node = (over: Partial<ConfigSchemaNode> = {}): ConfigSchemaNode => ({
  kind: "option",
  name: "memory",
  path: ["process", "memory"],
  description:
    "The `memory` directive.\n\n[Read more](https://docs.seqera.io/nextflow/reference/process/directives/memory)",
  docsUrl:
    "https://docs.seqera.io/nextflow/reference/process/directives/memory",
  types: ["MemoryUnit"],
  valueKind: "memory",
  children: [],
  ...over,
});
const html = (props: Parameters<typeof ConfigDetailsView>[0]) =>
  renderToStaticMarkup(<ConfigDetailsView {...props} />);

describe("F-601 config details", () => {
  it("F-601 FI-04: shows the full name, the types, the description without its Read more line, and the docs link", () => {
    const out = html({
      target: { kind: "option", row: row() },
      schemaNode: node(),
    });
    expect(out).toContain("process.memory");
    expect(out).toContain("MemoryUnit");
    expect(out).toContain("<code>memory</code>");
    expect(out).not.toContain("Read more");
    expect(out).toContain(
      'href="https://docs.seqera.io/nextflow/reference/process/directives/memory"',
    );
    expect(out).toContain("Open in Nextflow docs");
  });

  it("F-601 FI-04: types are joined by or", () => {
    const out = html({
      target: { kind: "option", row: row({ types: ["String", "Boolean"] }) },
      schemaNode: node({ types: ["String", "Boolean"] }),
    });
    expect(out).toContain("String");
    expect(out).toContain(" or ");
  });

  it("F-601 FI-03 FI-04: an unknown option says it isn't a Nextflow 26.10 option, and links the config reference", () => {
    const out = html({
      target: {
        kind: "option",
        row: row({
          option: ["process", "memmory"],
          label: "memmory",
          class: "unknown",
          types: [],
          value: null,
          code: "'4 GB'",
        }),
      },
      schemaNode: null,
    });
    expect(out).toContain("Unknown option");
    expect(out).toContain("isn&#x27;t a Nextflow 26.10 option");
    expect(out).toContain(
      'href="https://docs.seqera.io/nextflow/reference/config"',
    );
  });

  it("F-601 FI-04: a scope shows its description; nothing selected says to select an option", () => {
    const card = {
      key: "scope:/:docker",
      scope: "docker",
      known: true,
      form: "options",
      pinned: [],
      rows: [],
      selectors: [],
      profiles: [],
      plugins: [],
      range,
    } satisfies ScopeCard;
    const out = html({
      target: { kind: "scope", card },
      schemaNode: node({
        kind: "scope",
        name: "docker",
        path: ["docker"],
        description: "The `docker` scope controls how Docker is used.",
        docsUrl: null,
        types: [],
      }),
    });
    expect(out).toContain("docker");
    expect(out).toContain("controls how Docker is used");
    expect(html({ target: null, schemaNode: null })).toContain(
      "Select an option to see its description",
    );
  });

  it("F-601 FI-06: a selector shows its pattern, the processes it matches and the selector docs", () => {
    const card = {
      key: "sel:1",
      selector: { kind: "withLabel", pattern: "big_mem" },
      written: "withLabel: big_mem",
      range,
      rows: [],
      match: { count: 1, processes: ["SHOUT"], note: null },
    } satisfies SelectorCard;
    const out = html({ target: { kind: "selector", card }, schemaNode: null });
    expect(out).toContain("withLabel: big_mem");
    expect(out).toContain("SHOUT");
    expect(out).toContain("used by 1 process");
    expect(out).toContain("config#process-selectors");
  });

  it("F-601 FI-04: a pinned field that isn't set still shows its description", () => {
    expect(findTarget({ items: [] } as never, "unset:process.memory")).toEqual({
      kind: "unset",
      names: ["process", "memory"],
    });
    const out = html({
      target: { kind: "unset", names: ["process", "memory"] },
      schemaNode: node(),
    });
    expect(out).toContain("process.memory");
    expect(out).toContain("MemoryUnit");
  });

  it("F-601: findTarget finds a row, a scope card and a selector by key, and findSchemaNode walks a path", () => {
    const r = row({ key: "row:in-sel" });
    const sel: SelectorCard = {
      key: "sel:1",
      selector: null,
      written: "withFoo: x",
      range,
      rows: [r],
      match: null,
    };
    const card: ScopeCard = {
      key: "scope:/:process",
      scope: "process",
      known: true,
      form: "process",
      pinned: [],
      rows: [],
      selectors: [sel],
      profiles: [],
      plugins: [],
      range,
    };
    const view = {
      path: "nextflow.config",
      status: "modelled" as const,
      editable: true,
      context: { profile: null, selector: null },
      items: [{ kind: "scope" as const, card }],
    };
    expect(findTarget(view, "row:in-sel")).toEqual({ kind: "option", row: r });
    expect(findTarget(view, "sel:1")).toEqual({ kind: "selector", card: sel });
    expect(findTarget(view, "scope:/:process")).toEqual({
      kind: "scope",
      card,
    });
    expect(findTarget(view, "nope")).toBeNull();
    const tree = node({
      kind: "scope",
      name: "process",
      path: ["process"],
      children: [node()],
    });
    expect(findSchemaNode([tree], ["process", "memory"])?.name).toBe("memory");
    expect(findSchemaNode([tree], ["process", "nope"])).toBeNull();
  });
});
