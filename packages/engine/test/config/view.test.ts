import { describe, expect, it } from "vitest";
import {
  type ConfigView,
  type ConfigViewItem,
  EXCERPT_LIMIT,
  type OptionRow,
  type ScopeCard,
} from "../../src/config/types";
import { open, openTree, oracle } from "./helpers";

const FORMS = `// forms
manifest {
    description = 'Greets'
    nextflowVersion = '>=26.10.6'
}

docker.enabled = false
docker.runOptions = '-u 1000'

process {
    memory = 2.GB
    memory = 3.GB
    resourceLimits = [cpus: 4, memory: 8.GB]
    withName: GREET { cpus = 1 }
    withLabel: big_mem {
        memory = 8.GB
    }
}

cleanup = true

docker {
    registry = 'quay.io'
}

profiles {
    test {
        params.count = 1
        process.cpus = 2
    }
}
`;

const cards = (view: ConfigView): ScopeCard[] =>
  view.items.flatMap((i) => (i.kind === "scope" ? [i.card] : []));
const rows = (card: ScopeCard) =>
  card.rows.filter((r): r is OptionRow => r.kind === "option");

describe("F-601 config view", () => {
  it("F-601 FI-01: a config gives one card per top-level scope in order of first appearance, gathering block and dotted forms", async () => {
    const o = await open({ "nextflow.config": FORMS });
    const view = o.view("nextflow.config");
    expect(view.editable).toBe(true);
    expect(view.status).toBe("modelled");
    expect(view.context).toEqual({ profile: null, selector: null });
    expect(cards(view).map((c) => c.scope)).toEqual([
      "manifest",
      "docker",
      "process",
      "",
      "profiles",
    ]);
    const docker = cards(view)[1] as ScopeCard;
    expect(rows(docker).map((r) => r.option.join("."))).toEqual([
      "docker.enabled",
      "docker.runOptions",
      "docker.registry",
    ]);
    expect(docker.known).toBe(true);
    expect(docker.form).toBe("options");
    expect(docker.pinned).toEqual(["enabled", "runOptions", "registry"]);
    const unscoped = cards(view)[3] as ScopeCard;
    expect(unscoped.form).toBe("unscoped");
    expect(rows(unscoped).map((r) => r.option)).toEqual([["cleanup"]]);
  });

  it("F-601 FI-02: first-class cards carry their pinned fields; resourceLimits is a fixed-key map row; selectors carry their match", async () => {
    const o = await open({
      "main.nf":
        "process GREET {\n  script:\n  'a'\n}\nprocess SHOUT {\n  label 'big_mem'\n  script:\n  'b'\n}\nworkflow {\n  GREET(channel.of(1))\n  SHOUT(channel.of(2))\n}\n",
      "nextflow.config": FORMS,
    });
    const view = o.view("nextflow.config");
    const process = cards(view).find((c) => c.scope === "process") as ScopeCard;
    expect(process.form).toBe("process");
    expect(process.pinned.slice(0, 3)).toEqual(["cpus", "memory", "time"]);
    const memory = rows(process).find(
      (r) => r.option.join(".") === "process.memory",
    ) as OptionRow;
    expect(memory.occurrences).toBe(2);
    expect(memory.value).toEqual({ kind: "memory", amount: 3, unit: "GB" });
    expect(memory.valueKind).toBe("memory");
    expect(memory.class).toBe("option");
    expect(memory.types).toEqual(["MemoryUnit"]);
    expect(memory.label).toBe("memory");
    const limits = rows(process).find(
      (r) => r.option.join(".") === "process.resourceLimits",
    ) as OptionRow;
    expect(limits.valueKind).toBe("map");
    expect(limits.value?.kind).toBe("map");
    expect(process.selectors.map((s) => s.written)).toEqual([
      "withName: GREET",
      "withLabel: big_mem",
    ]);
    const [name, label] = process.selectors;
    expect(name?.selector).toEqual({ kind: "withName", pattern: "GREET" });
    expect(name?.match).toMatchObject({ count: 1, processes: ["GREET"] });
    expect(label?.match).toMatchObject({ count: 1, processes: ["SHOUT"] });
    const cpus = name?.rows[0] as OptionRow;
    expect(cpus.option).toEqual(["process", "cpus"]);
    expect(cpus.value).toEqual({ kind: "integer", value: 1 });
    const profiles = cards(view).find((c) => c.scope === "profiles");
    expect(profiles?.form).toBe("profiles");
    const test = profiles?.profiles[0];
    expect(test?.name).toBe("test");
    const inner = test?.items.flatMap((i: ConfigViewItem) =>
      i.kind === "scope" ? [i.card.scope] : [],
    );
    expect(inner).toEqual(["params", "process"]);
    const params = ((test?.items ?? [])[0] as { card: ScopeCard }).card;
    expect(params.form).toBe("params");
    const count = rows(params)[0] as OptionRow;
    expect(count.class).toBe("free");
    expect(count.valueKind).toBe("integer");
    expect(count.value).toEqual({ kind: "integer", value: 1 });
    // the manifest card
    const manifest = cards(view)[0] as ScopeCard;
    expect(rows(manifest).map((r) => r.value)).toEqual([
      { kind: "string", value: "Greets" },
      { kind: "string", value: ">=26.10.6" },
    ]);
    // selectors without any process in the project count 0 with the warning text
    const lone = await open({ "nextflow.config": FORMS });
    const loneProcess = cards(lone.view("nextflow.config")).find(
      (c) => c.scope === "process",
    ) as ScopeCard;
    expect(loneProcess.selectors[0]?.match?.count).toBe(0);
  });

  it("F-601 FI-03: f601-unknown flags process.memmory and mystery.level and keeps them as rows with code values", async () => {
    const o = await openTree(oracle("f601-unknown"));
    const view = o.view("nextflow.config");
    const process = cards(view).find((c) => c.scope === "process") as ScopeCard;
    const memmory = rows(process).find(
      (r) => r.option[1] === "memmory",
    ) as OptionRow;
    expect(memmory.class).toBe("unknown");
    expect(memmory.value).toBeNull();
    expect(memmory.code).toBe("'4 GB'");
    expect(memmory.valueKind).toBe("code");
    expect(memmory.diagnostics.map((d) => d.code)).toContain(
      "config-unknown-option",
    );
    const extra = o.view("conf/extra.config");
    const mystery = cards(extra)[0] as ScopeCard;
    expect(mystery.scope).toBe("mystery");
    expect(mystery.known).toBe(false);
    const level = rows(mystery)[0] as OptionRow;
    expect(level.class).toBe("unknown");
    expect(level.code).toBe("3");
    expect(level.diagnostics).toHaveLength(1);
    const docker = cards(extra)[1] as ScopeCard;
    expect(docker.scope).toBe("docker");
    expect(docker.rows).toEqual([]);
    expect(docker.known).toBe(true);
  });

  it("F-601 FI-05: include rows carry a file target, a missing-target message or external", async () => {
    const o = await open({
      "nextflow.config":
        "includeConfig 'conf/a.config'\nincludeConfig 'conf/none.config'\nincludeConfig \"${projectDir}/x.config\"\nprofiles {\n  p {\n    includeConfig 'conf/a.config'\n  }\n}\n",
      "conf/a.config": "docker.enabled = true\n",
    });
    const view = o.view("nextflow.config");
    const [file, missing, external, profiles] = view.items;
    if (file?.kind !== "include" || missing?.kind !== "include")
      throw new Error("not includes");
    expect(file.target).toEqual({ kind: "file", path: "conf/a.config" });
    expect(file.source).toBe("'conf/a.config'");
    expect(missing.target.kind).toBe("missing");
    expect(external?.kind === "include" && external.target).toEqual({
      kind: "external",
    });
    const profile =
      profiles?.kind === "scope" ? profiles.card.profiles[0] : undefined;
    expect(profile?.items[0]).toMatchObject({
      kind: "include",
      target: { kind: "file", path: "conf/a.config" },
    });
  });

  it("F-601: dynamic values, ConfigInvalid, ConfigIncomplete and Unparsed items are code rows; a file with problems is not editable", async () => {
    const o = await open({
      "nextflow.config":
        "process {\n  memory = { 2.GB * task.attempt }\n  cpus = params.cpus\n  time = 2.h // fast\n  container = 'a'\n}\ndef x = 1\nprocess.\n",
    });
    const view = o.view("nextflow.config");
    expect(view.editable).toBe(false);
    const process = cards(view).find((c) => c.scope === "process") as ScopeCard;
    const memory = rows(process).find(
      (r) => r.option[1] === "memory",
    ) as OptionRow;
    expect(memory.value).toBeNull();
    expect(memory.code).toBe("{ 2.GB * task.attempt }");
    const cpus = rows(process).find((r) => r.option[1] === "cpus") as OptionRow;
    expect(cpus.code).toBe("params.cpus");
    // a trailing comment is not inside the value
    const time = rows(process).find((r) => r.option[1] === "time") as OptionRow;
    expect(time.value).toEqual({ kind: "duration", amount: 2, unit: "h" });
    const code = view.items.flatMap((i) => (i.kind === "code" ? [i] : []));
    expect(code.map((c) => c.reason)).toEqual(["unparsed", "unparsed"]);
    expect(code[0]?.text).toBe("def x = 1");
    expect(code[0]?.problems.length).toBeGreaterThan(0);

    const incomplete = await open({ "nextflow.config": "process.\n" });
    const iv = incomplete.view("nextflow.config");
    expect(iv.editable).toBe(false);
    expect(iv.items).toHaveLength(1);
    expect(iv.items[0]).toMatchObject({ kind: "code", reason: "unparsed" });
    expect(
      iv.items[0]?.kind === "code" && iv.items[0].problems.length,
    ).toBeGreaterThan(0);

    const comment = await open({
      "nextflow.config":
        "process {\n  memory = [\n    // why\n    1\n  ]\n  cpus = 1 + /* a */ 1\n}\n",
    });
    const cv = comment.view("nextflow.config");
    expect(cv.editable).toBe(true);
    const cr = rows(cards(cv)[0] as ScopeCard);
    expect(cr.every((r) => r.value === null && r.code !== null)).toBe(true);

    const clean = await open({ "nextflow.config": "docker.enabled = true\n" });
    expect(clean.view("nextflow.config").editable).toBe(true);
  });

  it("F-601: selectors outside process and unknown selector kinds are read-only cards", async () => {
    const o = await open({
      "nextflow.config":
        "process {\n  withFoo: x { cpus = 1 }\n}\ndocker {\n  withName: y { enabled = true }\n}\n",
    });
    const view = o.view("nextflow.config");
    const [process, docker] = cards(view);
    const a = process?.selectors[0];
    expect(a?.selector).toBeNull();
    expect(a?.written).toBe("withFoo: x");
    expect(a?.match).toBeNull();
    expect(rows(docker as ScopeCard)).toEqual([]);
    const b = docker?.selectors[0];
    expect(b?.selector).toBeNull();
    expect(((b?.rows ?? [])[0] as OptionRow).valueKind).toBe("code");
  });

  it("F-601 AR-30: no excerpt in a view exceeds 160 characters or spans lines", async () => {
    const long = `'${"x".repeat(400)}'`;
    const o = await open({
      "nextflow.config": `process {\n  memory = {\n    ${long}\n  }\n  container = params.${"a".repeat(300)}\n}\nincludeConfig ${long}\n`,
    });
    const view = o.view("nextflow.config");
    const excerpts: string[] = [];
    const visit = (items: readonly ConfigViewItem[]) => {
      for (const item of items) {
        if (item.kind === "code") excerpts.push(item.text);
        else if (item.kind === "include") excerpts.push(item.source);
        else {
          const rowsOf = [
            ...item.card.rows,
            ...item.card.selectors.flatMap((s) => s.rows),
          ];
          for (const r of rowsOf) {
            if (r.kind === "option" && r.code !== null) excerpts.push(r.code);
            if (r.kind === "code") excerpts.push(r.text);
            if (r.kind === "include") excerpts.push(r.source);
          }
          for (const p of item.card.profiles) visit(p.items);
        }
      }
    };
    visit(view.items);
    expect(excerpts.length).toBeGreaterThanOrEqual(3);
    for (const e of excerpts) {
      expect(e.length).toBeLessThanOrEqual(EXCERPT_LIMIT);
      expect(e).not.toMatch(/[\r\n]/);
    }
    expect(EXCERPT_LIMIT).toBe(160);
  });

  it("F-601 FI-01: plugins give rows split into name and version", async () => {
    const o = await open({
      "nextflow.config":
        "plugins {\n  id 'nf-schema@2.5.1'\n  id 'nf-prov'\n}\n",
    });
    const card = cards(o.view("nextflow.config"))[0] as ScopeCard;
    expect(card.form).toBe("plugins");
    expect(card.plugins.map((p) => [p.id, p.name, p.version])).toEqual([
      ["nf-schema@2.5.1", "nf-schema", "2.5.1"],
      ["nf-prov", "nf-prov", null],
    ]);
  });
});
