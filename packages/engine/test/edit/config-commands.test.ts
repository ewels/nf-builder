// F-601 (AR-21, AR-22, AR-23, AR-24, ADR 0032): the five config commands.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ConfigContext,
  ConfigValue,
  EditCommand,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { applyCommand, commit, type EditState } from "../../src/edit/apply";
import { applyPatches } from "../../src/edit/patches";
import { readTree } from "../model/read-tree";
import { accepted, refused, stateFor, texts } from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const tree = (name: string) =>
  Object.fromEntries(readTree(join(cases, name)).map((f) => [f.path, f.text]));
const read = (name: string, path: string) =>
  readFileSync(join(cases, name, path), "utf8");

const P = "nextflow.config";
const TOP: ConfigContext = { profile: null, selector: null };
const inProfile = (profile: string): ConfigContext => ({
  profile,
  selector: null,
});
const label = (
  pattern: string,
  profile: string | null = null,
): ConfigContext => ({
  profile,
  selector: { kind: "withLabel", pattern },
});
const name = (pattern: string): ConfigContext => ({
  profile: null,
  selector: { kind: "withName", pattern },
});
const str = (value: string): ConfigValue => ({ kind: "string", value });
const mem = (amount: number): ConfigValue => ({
  kind: "memory",
  amount,
  unit: "GB",
});
const dur = (amount: number, unit: "h" | "s" | "min" = "h"): ConfigValue => ({
  kind: "duration",
  amount,
  unit,
});
const int = (value: number): ConfigValue => ({ kind: "integer", value });
const bool = (value: boolean): ConfigValue => ({ kind: "boolean", value });

const set = (
  option: string[],
  value: ConfigValue,
  context: ConfigContext = TOP,
  path = P,
): EditCommand => ({ kind: "setConfigOption", path, context, option, value });
const remove = (
  option: string[],
  context: ConfigContext = TOP,
  path = P,
): EditCommand => ({ kind: "removeConfigOption", path, context, option });
const block = (
  scope: string[],
  context: ConfigContext = TOP,
  path = P,
): EditCommand => ({ kind: "addConfigBlock", path, context, scope });
const plugin = (id: string): EditCommand => ({
  kind: "addConfigPlugin",
  path: P,
  id,
});
const unplugin = (id: string): EditCommand => ({
  kind: "removeConfigPlugin",
  path: P,
  id,
});

/** Applies the commands in order; each inverse must restore the bytes before it. Returns the config's text after each. */
async function run(
  files: Record<string, string>,
  commands: EditCommand[],
): Promise<{ state: EditState; after: string[] }> {
  const state = await stateFor(files);
  const after: string[] = [];
  for (const command of commands) {
    const before = texts(state);
    const r = accepted(state, command);
    commit(state, r);
    after.push(state.model.file(P)?.source.text ?? "");
    const undone = applyPatches(
      new Map(Object.entries(texts(state))),
      r.inverse,
    );
    expect(Object.fromEntries(undone.files), `undo of ${command.kind}`).toEqual(
      before,
    );
    expect(state.model.file(P)?.source.problems ?? []).toEqual([]);
  }
  return { state, after };
}

const last = (r: { after: string[] }) => r.after[r.after.length - 1];

describe("F-601 config commands", () => {
  it("F-601 step 1 FI-02 AR-23: addConfigBlock process, setConfigOption process.memory, addConfigBlock withLabel big_mem and setConfigOption in it turn f601-config into f601-config-after byte for byte; each inverse restores the previous bytes", async () => {
    const r = await run(tree("f601-config"), [
      block(["process"]),
      set(["process", "memory"], mem(2)),
      block([], label("big_mem")),
      set(["process", "memory"], mem(8), label("big_mem")),
    ]);
    expect(r.after[0]).toBe(`${read("f601-config", P)}\nprocess {\n}\n`);
    expect(last(r)).toBe(read("f601-config-after", P));
  });

  it("F-601 step 2 FI-03: setConfigOption process.cpus on f601-unknown gives f601-unknown-after, and the unknown option's line is byte-identical", async () => {
    const r = await run(tree("f601-unknown"), [
      set(["process", "cpus"], int(2)),
    ]);
    expect(last(r)).toBe(read("f601-unknown-after", P));
    expect(last(r)).toContain(
      "    memmory = '4 GB' // misspelt: kept and flagged\n",
    );
    expect(r.state.model.file("conf/extra.config")?.source.text).toBe(
      read("f601-unknown", "conf/extra.config"),
    );
  });

  it("F-601 FI-02 ADR-0032: the scripted sequence turns f601-forms into f601-forms-after", async () => {
    const r = await run(tree("f601-forms"), [
      set(["manifest", "name"], str("greeter")),
      set(["docker", "runOptions"], str("-u 1000")),
      set(["process", "memory"], mem(4), name("GREET")),
      set(["process", "memory"], mem(2)),
      set(["process", "time"], dur(1)),
      set(["process", "errorStrategy"], str("retry")),
      set(["process", "maxRetries"], int(3)),
      set(["process", "resourceLimits"], {
        kind: "map",
        entries: [
          { key: "cpus", value: int(4) },
          { key: "memory", value: mem(8) },
          { key: "time", value: dur(2) },
        ],
      }),
      block([], label("big_mem")),
      set(["process", "memory"], mem(8), label("big_mem")),
      set(["wave", "build", "repository"], str("quay.io/example/wave")),
      set(["conda", "channels"], {
        kind: "stringList",
        values: ["conda-forge", "bioconda"],
      }),
      set(["executor", "queueSize"], int(10)),
      set(["executor", "pollInterval"], dur(5, "s")),
      set(["env", "GREETING_STYLE"], str("loud")),
      set(["params", "ratio"], { kind: "decimal", text: "0.5" }),
      set(["params", "loud"], bool(true)),
      set(["cleanup"], bool(true)),
      set(["process", "cpus"], int(2), inProfile("test")),
      set(["process", "memory"], mem(16), inProfile("gpu-test")),
      remove(["docker", "enabled"]),
    ]);
    expect(last(r)).toBe(read("f601-forms-after", P));
  });

  it("F-601 ADR-0032: each placement rule puts the statement where the plan says", async () => {
    const files = (config: string) => ({ [P]: config });
    // rule 1: replaces the value in any form, the last occurrence
    let r = await run(files("process.cpus = 1\nprocess {\n    cpus = 2\n}\n"), [
      set(["process", "cpus"], int(4)),
    ]);
    expect(last(r)).toBe("process.cpus = 1\nprocess {\n    cpus = 4\n}\n");
    r = await run(files("docker.enabled = false // off\n"), [
      set(["docker", "enabled"], bool(true)),
    ]);
    expect(last(r)).toBe("docker.enabled = true // off\n");
    // rule 2: last statement of the block, indentation of the previous sibling
    r = await run(files("docker {\n    enabled = true\n}\n"), [
      set(["docker", "registry"], str("quay.io")),
    ]);
    expect(last(r)).toBe(
      "docker {\n    enabled = true\n    registry = 'quay.io'\n}\n",
    );
    // rule 3: the rest of the path in dotted form
    r = await run(files("wave {\n    enabled = true\n}\n"), [
      set(["wave", "build", "repository"], str("r")),
    ]);
    expect(last(r)).toBe(
      "wave {\n    enabled = true\n    build.repository = 'r'\n}\n",
    );
    // rule 4: after the last dotted assignment of the same scope
    r = await run(
      files(
        "docker.enabled = true\nworkDir = 'work'\ndocker.registry = 'a'\ncleanup = true\n",
      ),
      [set(["docker", "runOptions"], str("-u 1"))],
    );
    expect(last(r)).toBe(
      "docker.enabled = true\nworkDir = 'work'\ndocker.registry = 'a'\ndocker.runOptions = '-u 1'\ncleanup = true\n",
    );
    // rule 5: a new block after one blank line, at the end
    r = await run(files("includeConfig 'conf/a.config'\n"), [
      set(["docker", "enabled"], bool(true)),
    ]);
    expect(last(r)).toBe(
      "includeConfig 'conf/a.config'\n\ndocker {\n    enabled = true\n}\n",
    );
    r = await run(files("manifest {\n    name = 'a'\n}\n"), [
      set(["wave", "build", "repository"], str("r")),
    ]);
    expect(last(r)).toBe(
      "manifest {\n    name = 'a'\n}\n\nwave {\n    build.repository = 'r'\n}\n",
    );
    // unscoped options follow a top-level assignment directly
    r = await run(files("workDir = 'w'\n"), [set(["cleanup"], bool(true))]);
    expect(last(r)).toBe("workDir = 'w'\ncleanup = true\n");
    r = await run(files("docker.enabled = true"), [
      set(["cleanup"], bool(true)),
    ]);
    expect(last(r)).toBe("docker.enabled = true\ncleanup = true\n");
    // a profile: a dotted assignment at its end; a missing profile joins the last profiles block or a new one
    r = await run(
      files("profiles {\n    test {\n        params.count = 1\n    }\n}\n"),
      [
        set(["process", "cpus"], int(2), inProfile("test")),
        set(["process", "memory"], mem(8), inProfile("big node")),
      ],
    );
    expect(r.after[0]).toBe(
      "profiles {\n    test {\n        params.count = 1\n        process.cpus = 2\n    }\n}\n",
    );
    expect(last(r)).toBe(
      "profiles {\n    test {\n        params.count = 1\n        process.cpus = 2\n    }\n    'big node' {\n        process.memory = 8.GB\n    }\n}\n",
    );
    r = await run(files("docker.enabled = true\n"), [
      set(["params", "x"], int(1), inProfile("test")),
    ]);
    expect(last(r)).toBe(
      "docker.enabled = true\n\nprofiles {\n    test {\n        params.x = 1\n    }\n}\n",
    );
    // a selector is always a block, inside the process block or a new one
    r = await run(files("process {\n    cpus = 1\n}\n"), [
      set(["process", "memory"], mem(8), label("big")),
    ]);
    expect(last(r)).toBe(
      "process {\n    cpus = 1\n    withLabel: big {\n        memory = 8.GB\n    }\n}\n",
    );
    r = await run(files("docker.enabled = true\n"), [
      set(["process", "ext", "a"], int(1), name("A.*")),
    ]);
    expect(last(r)).toBe(
      "docker.enabled = true\n\nprocess {\n    withName: 'A.*' {\n        ext.a = 1\n    }\n}\n",
    );
    // inside an existing selector, and a selector of a profile
    r = await run(
      files("process {\n    withLabel: big {\n        cpus = 1\n    }\n}\n"),
      [set(["process", "memory"], mem(8), label("big"))],
    );
    expect(last(r)).toBe(
      "process {\n    withLabel: big {\n        cpus = 1\n        memory = 8.GB\n    }\n}\n",
    );
    r = await run(
      files("profiles {\n    t {\n        docker.enabled = true\n    }\n}\n"),
      [set(["process", "memory"], mem(8), label("big", "t"))],
    );
    expect(last(r)).toBe(
      "profiles {\n    t {\n        docker.enabled = true\n        process {\n            withLabel: big {\n                memory = 8.GB\n            }\n        }\n    }\n}\n",
    );
  });

  it("F-601 IO-33: the plugin and block sequence gives f601-plugins", async () => {
    const r = await run(tree("f601-config"), [
      plugin("nf-schema@2.5.1"),
      plugin("nf-prov@1.4.0"),
      unplugin("nf-prov@1.4.0"),
      block([], inProfile("test")),
      block(["docker"]),
    ]);
    expect(r.after[0]).toBe(
      `${read("f601-config", P)}\nplugins {\n    id 'nf-schema@2.5.1'\n}\n`,
    );
    expect(r.after[1]).toContain(
      "    id 'nf-schema@2.5.1'\n    id 'nf-prov@1.4.0'\n}\n",
    );
    expect(r.after[2]).toBe(r.after[0]);
    expect(last(r)).toBe(read("f601-plugins", P));
  });

  it("F-601 ADR-0032: inserting into a one-line block reprints only that block, keeping its comments", async () => {
    const config =
      "// head\nprocess {\n    withName: A { cpus = 1 } // trailing\n    // before B\n    withName: B { cpus = 2 }\n    memory = 1.GB\n}\n\n// tail\ndocker.enabled = true\n";
    const r = await run({ [P]: config }, [
      set(["process", "memory"], mem(4), name("A")),
    ]);
    expect(last(r)).toBe(
      config.replace(
        "withName: A { cpus = 1 } // trailing",
        "withName: A {\n        cpus = 1\n        memory = 4.GB\n    } // trailing",
      ),
    );
    const empty = await run({ [P]: "docker {}\n" }, [
      set(["docker", "enabled"], bool(true)),
    ]);
    expect(last(empty)).toBe("docker {\n    enabled = true\n}\n");
    const shared = await run({ [P]: "docker {\n    enabled = true }\n" }, [
      set(["docker", "registry"], str("r")),
    ]);
    expect(last(shared)).toBe(
      "docker {\n    enabled = true\n    registry = 'r'\n}\n",
    );
  });

  it("F-601: removeConfigOption removes every occurrence in its context with the comments attached to them and leaves the container", async () => {
    const config =
      "process {\n    // threads\n    cpus = 1 // one\n    memory = 2.GB\n    cpus = 2\n}\nprocess.cpus = 3\nprofiles {\n    t {\n        process.cpus = 9\n    }\n}\n";
    const r = await run({ [P]: config }, [remove(["process", "cpus"])]);
    expect(last(r)).toBe(
      "process {\n    memory = 2.GB\n}\nprofiles {\n    t {\n        process.cpus = 9\n    }\n}\n",
    );
    const only = await run({ [P]: "docker {\n    enabled = true\n}\n" }, [
      remove(["docker", "enabled"]),
    ]);
    expect(last(only)).toBe("docker {\n}\n");
    const shared = await run(
      { [P]: "process { cpus = 1\n    memory = 2.GB }\n" },
      [remove(["process", "cpus"])],
    );
    expect(last(shared)).toBe("process {\n    memory = 2.GB\n}\n");
    const inProf = await run({ [P]: config }, [
      remove(["process", "cpus"], inProfile("t")),
    ]);
    expect(last(inProf)).toBe(config.replace("        process.cpus = 9\n", ""));
    const sel = await run(
      {
        [P]: "process {\n    withLabel: x {\n        cpus = 1\n        memory = 1.GB\n    }\n}\n",
      },
      [remove(["process", "cpus"], label("x"))],
    );
    expect(last(sel)).toBe(
      "process {\n    withLabel: x {\n        memory = 1.GB\n    }\n}\n",
    );
  });

  it("F-601: commands keep CRLF endings and the file's indent unit (tabs, two spaces)", async () => {
    const crlf = "docker {\r\n    enabled = true\r\n}\r\n";
    let r = await run({ [P]: crlf }, [
      set(["docker", "registry"], str("r")),
      set(["wave", "enabled"], bool(true)),
    ]);
    expect(last(r)).toBe(
      "docker {\r\n    enabled = true\r\n    registry = 'r'\r\n}\r\n\r\nwave {\r\n    enabled = true\r\n}\r\n",
    );
    r = await run({ [P]: "docker {\n\tenabled = true\n}\nwave {\n}\n" }, [
      set(["wave", "enabled"], bool(true)),
      set(["process", "ext", "a"], int(1), name("X")),
    ]);
    expect(last(r)).toBe(
      "docker {\n\tenabled = true\n}\nwave {\n\tenabled = true\n}\n\nprocess {\n\twithName: X {\n\t\text.a = 1\n\t}\n}\n",
    );
    r = await run({ [P]: "docker {\n  enabled = true\n}\nwave {\n}\n" }, [
      set(["wave", "enabled"], bool(true)),
    ]);
    expect(last(r)).toBe(
      "docker {\n  enabled = true\n}\nwave {\n  enabled = true\n}\n",
    );
  });

  it("F-601 AR-24: invalid names, a selector option outside process, a duplicate plugin, a malformed plugin id and a value with comments inside are refused and change nothing", async () => {
    const state = await stateFor({
      [P]: "plugins {\n    id 'nf-schema@2.5.1'\n}\nprocess {\n    memory = [\n        // why\n        1\n    ]\n}\n",
      "x.nf": "workflow {}\n",
    });
    const before = texts(state);
    const cases: [EditCommand, RegExp, string][] = [
      [set(["params", "my-name"], int(1)), /identifier/, "invalid"],
      [set(["process", "ext", "my-key"], int(1)), /identifier/, "invalid"],
      [set(["process", "ext", "default"], int(1)), /identifier/, "invalid"],
      [set(["env", "A B"], int(1)), /identifier/, "invalid"],
      [
        set(["docker", "enabled"], bool(true), label("x")),
        /process/,
        "invalid",
      ],
      [plugin("nf-schema@2.9.9"), /already/, "invalid"],
      [plugin("nf schema"), /plugin id/, "invalid"],
      [plugin("nf-schema@"), /plugin id/, "invalid"],
      [set(["process", "memory"], mem(1)), /comment/, "invalid"],
      [
        set(["process", "cpus"], int(Number.MAX_SAFE_INTEGER + 2)),
        /whole number/,
        "invalid",
      ],
      [
        set(["process", "cpus"], { kind: "decimal", text: "1e3" }),
        /number/,
        "invalid",
      ],
      [set([], int(1)), /option/, "invalid"],
      [
        set(["docker", "enabled"], bool(true), TOP, "x.nf"),
        /config/,
        "not-found",
      ],
      [
        set(["docker", "enabled"], bool(true), TOP, "missing.config"),
        /config/,
        "not-found",
      ],
      [remove(["docker", "enabled"]), /nothing to remove/i, "not-found"],
      [unplugin("nf-prov@1.0.0"), /nothing to remove/i, "not-found"],
      [
        remove(["process", "cpus"], inProfile("none")),
        /nothing to remove/i,
        "not-found",
      ],
    ];
    for (const [command, message, code] of cases) {
      const r = refused(state, command);
      expect(r.code, JSON.stringify(command)).toBe(code);
      expect(r.message).toMatch(message);
    }
    expect(texts(state)).toEqual(before);
    // a broken file is refused by the AR-24 guard when the edit would add a problem; the form itself is read-only
    const broken = await stateFor({ [P]: "docker {\n    enabled = \n}\n" });
    const result = applyCommand(broken, set(["docker", "registry"], str("r")));
    expect(result.ok).toBe(false);
  });

  it("F-601 F-209: setting the same value or adding an existing block yields no patch", async () => {
    const state = await stateFor({
      [P]: "docker {\n    enabled = true\n}\nprofiles {\n    t {\n    }\n}\nprocess {\n    withLabel: x {\n    }\n}\nplugins {\n    id 'a'\n}\n",
    });
    for (const command of [
      set(["docker", "enabled"], bool(true)),
      block(["docker"]),
      block([], inProfile("t")),
      block([], label("x")),
    ]) {
      const r = accepted(state, command);
      expect(r.patches, command.kind).toEqual([]);
    }
  });
});
