// F-601 (AR-22, AR-23, AR-24, ADR 0032, FI-03): random config commands over the f601 trees and configs shaped like the
// corpus's. Whatever a command does, every statement it doesn't target keeps its exact text, the file gains no parse
// problem, the value read back is the value set, and the inverse restores the bytes.
import { join } from "node:path";
import type {
  ConfigAst,
  ConfigContext,
  ConfigSourceFile,
  ConfigValue,
  EditCommand,
} from "@nf-builder/lang-core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readValue, valueExpression } from "../../src/config/values";
import { applyCommand, commit, type EditState } from "../../src/edit/apply";
import {
  descend,
  occurrences,
  placement,
  plugins,
} from "../../src/edit/config/locate";
import { problemKeys } from "../../src/edit/guards";
import { applyPatches } from "../../src/edit/patches";
import { createSourceFile } from "../../src/source/source-file";
import { readTree } from "../model/read-tree";
import { checkUntouched } from "./config-untouched";
import { snapshot } from "./harness";
import { stateFor } from "./helpers";

const root = new URL("../../../../", import.meta.url).pathname;
const oracle = (name: string) => join(root, "tools/oracle/cases", name);
const runs = Number(process.env.F111_RUNS ?? 25);

const NFCORE = `// base config
process {
    cpus   = { 1      * task.attempt }
    memory = { 6.GB   * task.attempt } // scales
    time   = { 4.h    * task.attempt }

    errorStrategy = { task.exitStatus in ((130..145) + 104) ? 'retry' : 'finish' }
    maxRetries    = 1

    withLabel:process_single {
        cpus   = { 1                   }
        memory = { 6.GB * task.attempt }
    }
    withName: 'FOO.*' { cpus = 2 }
    withName:CUSTOM_DUMP { publishDir = [ path: 'out', mode: 'copy' ] }
}

params {
    // Input options
    input = null
    max_cpus = 16
}

includeConfig 'conf/modules.config'

profiles {
    debug {
        dumpHashes = true
        process.beforeScript = 'echo $HOSTNAME'
    }
    docker {
        docker.enabled = true
        docker.runOptions = '-u $(id -u):$(id -g)'
    }
    test { includeConfig 'conf/test.config' }
}

manifest {
    name = 'x/y'
    version = '1.0'
}

validation.defaultIgnoreParams = ['genomes']
`;
const CRLF = NFCORE.replace(/\n/g, "\r\n");

interface Tree {
  name: string;
  files: () => Promise<Record<string, string>> | Record<string, string>;
}
const tree = (name: string): Tree => ({
  name,
  files: () =>
    Object.fromEntries(readTree(oracle(name)).map((f) => [f.path, f.text])),
});
const trees: Tree[] = [
  tree("f601-config"),
  tree("f601-forms"),
  tree("f601-forms-after"),
  tree("f601-unknown"),
  {
    name: "an nf-core style config",
    files: () => ({ "nextflow.config": NFCORE }),
  },
  {
    name: "the same with CRLF line ends",
    files: () => ({ "nextflow.config": CRLF }),
  },
  { name: "an empty config", files: () => ({ "nextflow.config": "" }) },
  {
    name: "a config with plugins",
    files: () => ({
      "nextflow.config":
        "plugins {\n    id 'nf-schema@2.5.1'\n    id 'nf-prov'\n}\n\nprocess.cpus = 1\nprocess {\n    memory = 1.GB\n    // x\n    time = 1.h // y\n}\n",
    }),
  },
  {
    name: "tabs and one-line blocks",
    files: () => ({
      "nextflow.config":
        "docker { enabled = true }\nprocess {\n\tcpus = 1 }\nwave {}\nprofiles { a { params.x = 1 } }\n",
    }),
  },
];

type Kind =
  | "integer"
  | "memory"
  | "duration"
  | "string"
  | "boolean"
  | "stringList"
  | "decimal";
const OPTIONS: [string[], Kind][] = [
  [["process", "cpus"], "integer"],
  [["process", "memory"], "memory"],
  [["process", "time"], "duration"],
  [["process", "container"], "string"],
  [["process", "ext", "flag"], "boolean"],
  [["docker", "enabled"], "boolean"],
  [["docker", "runOptions"], "string"],
  [["wave", "build", "repository"], "string"],
  [["conda", "channels"], "stringList"],
  [["executor", "queueSize"], "integer"],
  [["params", "ratio"], "decimal"],
  [["env", "MODE"], "string"],
  [["cleanup"], "boolean"],
  [["manifest", "name"], "string"],
  [["validation", "monochromeLogs"], "boolean"],
];
const STRINGS = ["a", "it's", "x\\y", "$HOME", "a b", "two\nlines", ""];
const PROFILES = ["test", "gpu-test", "ci", "debug"];
const SELECTORS = [
  { kind: "withLabel", pattern: "big_mem" },
  { kind: "withLabel", pattern: "process_single" },
  { kind: "withName", pattern: "GREET" },
  { kind: "withName", pattern: "FOO.*" },
] as const;
const PLUGINS = ["nf-schema@2.5.1", "nf-prov@1.4.0", "nf-wave", "nf-schema"];

function configValueFor(kind: Kind, n: number): ConfigValue {
  switch (kind) {
    case "integer":
      return { kind, value: (n % 200) - 100 };
    case "memory":
      return {
        kind,
        amount: n % 64,
        unit: (["MB", "GB", "TB"] as const)[n % 3] as "GB",
      };
    case "duration":
      return {
        kind,
        amount: n % 90,
        unit: (["min", "h", "d"] as const)[n % 3] as "h",
      };
    case "string":
      return { kind, value: STRINGS[n % STRINGS.length] as string };
    case "boolean":
      return { kind, value: n % 2 === 0 };
    case "stringList":
      return { kind, values: STRINGS.slice(0, n % 4) };
    case "decimal":
      return { kind, text: `${n % 10}.${n % 7}` };
  }
}

interface Choice {
  kind: number;
  file: number;
  ctx: number;
  opt: number;
  val: number;
}
const choiceArb: fc.Arbitrary<Choice> = fc.record({
  kind: fc.nat(4),
  file: fc.nat(100),
  ctx: fc.nat(1000),
  opt: fc.nat(1000),
  val: fc.nat(1000),
});

const pick = <T>(list: readonly T[], i: number): T =>
  list[i % list.length] as T;

function build(state: EditState, c: Choice): EditCommand | null {
  const configs = state.model
    .paths()
    .filter((p) => state.model.file(p)?.source.language === "config");
  const path = configs.length === 0 ? null : pick(configs, c.file);
  if (path === null) return null;
  const [option, kind] = pick(OPTIONS, c.opt);
  const isProcess = option[0] === "process";
  const choice = c.ctx % 8;
  const profile = choice >= 4 ? pick(PROFILES, c.ctx) : null;
  const selector =
    isProcess && (choice === 1 || choice === 2 || choice === 5 || choice === 6)
      ? pick(SELECTORS, c.ctx)
      : null;
  const context: ConfigContext = { profile, selector };
  switch (c.kind) {
    case 0:
      return {
        kind: "setConfigOption",
        path,
        context,
        option,
        value: configValueFor(kind, c.val),
      };
    case 1: {
      // usually an option the context sets, so removals are accepted too
      const file = state.model.file(path)?.source;
      const set =
        file?.language === "config" && file.ast
          ? OPTIONS.filter(
              ([o]) =>
                occurrences(file.ast as ConfigAst, context, o).length > 0,
            )
          : [];
      const target =
        set.length > 0 && c.val % 4 !== 0 ? pick(set, c.val)[0] : option;
      return { kind: "removeConfigOption", path, context, option: target };
    }
    case 2:
      return {
        kind: "addConfigBlock",
        path,
        context,
        scope:
          c.val % 3 === 0 && selector === null ? [option[0] as string] : [],
      };
    case 3:
      return { kind: "addConfigPlugin", path, id: pick(PLUGINS, c.val) };
    default: {
      // usually a plugin the file has, so removals are accepted too
      const file = state.model.file(path)?.source;
      const present =
        file?.language === "config" && file.ast
          ? plugins(file.ast).flatMap(({ node }) =>
              node.args[0]?.kind === "String" ? [node.args[0].value] : [],
            )
          : [];
      const id =
        present.length > 0 && c.val % 4 !== 0
          ? pick(present, c.val)
          : pick(PLUGINS, c.val);
      return { kind: "removeConfigPlugin", path, id };
    }
  }
}

function checkEffect(command: EditCommand, after: ConfigSourceFile) {
  const ast = after.ast as ConfigAst;
  switch (command.kind) {
    case "setConfigOption": {
      const found = occurrences(ast, command.context, command.option);
      const last = found[found.length - 1];
      expect(last, "the option is set").toBeDefined();
      const want = command.value;
      const got = readValue(
        (last as NonNullable<typeof last>).node.value,
        want.kind,
      );
      expect(got, `the value read back (${command.option.join(".")})`).toEqual(
        readValue(valueExpression(want), want.kind),
      );
      break;
    }
    case "removeConfigOption":
      expect(occurrences(ast, command.context, command.option)).toEqual([]);
      break;
    case "addConfigBlock": {
      const place = placement(ast, command.context);
      expect(place.ready, "the context exists").toBe(true);
      expect(descend(place.statements, command.scope)).toHaveLength(
        command.scope.length,
      );
      break;
    }
    case "addConfigPlugin":
      expect(
        plugins(ast).some(
          ({ node }) =>
            node.args[0]?.kind === "String" &&
            node.args[0].value === command.id,
        ),
      ).toBe(true);
      break;
    case "removeConfigPlugin":
      expect(
        plugins(ast).some(
          ({ node }) =>
            node.args[0]?.kind === "String" &&
            node.args[0].value === command.id,
        ),
      ).toBe(false);
      break;
  }
}

const accepted = new Map<string, number>();
const refused = new Map<string, number>();

function runSequence(state: EditState, choices: readonly Choice[]) {
  const base = snapshot(state);
  const history: (readonly import("@nf-builder/lang-core").TextPatch[])[] = [];
  for (const choice of choices) {
    const command = build(state, choice);
    if (!command) continue;
    const before = snapshot(state);
    const result = applyCommand(state, command);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(snapshot(state)).toEqual(before);
      const key = `${command.kind}:${result.code}`;
      refused.set(key, (refused.get(key) ?? 0) + 1);
      // a refusal of a command's own making is a bug: only an invalid or missing target is expected
      expect(
        ["invalid", "not-found", "does-not-parse"],
        `${key}: ${result.message}`,
      ).toContain(result.code);
      continue;
    }
    accepted.set(command.kind, (accepted.get(command.kind) ?? 0) + 1);
    for (const patch of result.patches) {
      if (patch.kind !== "edit") throw new Error("config commands only edit");
      const old = state.model.file(patch.path)?.source as ConfigSourceFile;
      const text = result.files.find((f) => f.path === patch.path)
        ?.text as string;
      const now = createSourceFile(
        patch.path,
        text,
        state.parser,
      ) as ConfigSourceFile;
      // AR-24: no problem the file didn't have
      const have = new Map<string, number>();
      for (const k of problemKeys(old)) have.set(k, (have.get(k) ?? 0) + 1);
      for (const k of problemKeys(now)) {
        const n = have.get(k) ?? 0;
        expect(n, `${command.kind}: new problem ${k}`).toBeGreaterThan(0);
        have.set(k, n - 1);
      }
      if (old.status === "modelled") expect(now.status).toBe("modelled");
      expect(patch.path).toBe((command as { path: string }).path);
      if (old.ast !== null)
        checkUntouched(old, text, patch.edits, command.kind);
      checkEffect(command, now);
    }
    commit(state, result);
    history.push(result.inverse);
  }
  let current = snapshot(state);
  for (const inverse of history.reverse())
    current = applyPatches(current, inverse).files;
  expect(Object.fromEntries(current)).toEqual(Object.fromEntries(base));
}

describe("F-601 config command properties", () => {
  for (const t of trees)
    it(`F-601 AR-22 ADR-0032 FI-03: random config commands on ${t.name} keep every other statement's exact text, keep unknown statements, add no parse problem, and their inverse restores the bytes`, async () => {
      const state = await stateFor(await t.files());
      const base = snapshot(state);
      fc.assert(
        fc.property(
          fc.array(choiceArb, { minLength: 1, maxLength: 4 }),
          (choices) => {
            try {
              runSequence(state, choices);
            } finally {
              for (const p of state.model.paths())
                if (!base.has(p)) state.model.deleteFile(p);
              for (const [p, text] of base)
                if (state.model.file(p)?.source.text !== text)
                  state.model.setFile(p, text);
            }
          },
        ),
        { seed: 601, numRuns: runs },
      );
    }, 180_000);

  it("F-601: every config command kind was accepted at least once", () => {
    if (process.env.F601_STATS) console.log(accepted, refused);
    for (const kind of [
      "setConfigOption",
      "removeConfigOption",
      "addConfigBlock",
      "addConfigPlugin",
      "removeConfigPlugin",
    ])
      expect(accepted.get(kind) ?? 0, `${kind} accepted`).toBeGreaterThan(0);
  });
});
