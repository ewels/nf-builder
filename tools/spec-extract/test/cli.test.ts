import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureJar,
  main,
  normalise,
  packDir,
  readPin,
  runExtractor,
  serialise,
} from "../src/cli.ts";

const temp = () => mkdtempSync(join(tmpdir(), "spec-extract-"));

const PIN = {
  tag: "v1.2.3",
  nfLang: "1.2.4",
  url: "https://example.invalid/language-server-all.jar",
  sha256: "0".repeat(64),
};

const SOURCE = {
  generator: "tools/spec-extract",
  languageServer: "v1.2.3",
  nfLang: "1.2.4",
  jarSha256: "0".repeat(64),
} as const;

function fakeRepo(): string {
  const root = temp();
  const pack = join(root, "packages", "lang-2610");
  mkdirSync(join(pack, "grammar"), { recursive: true });
  writeFileSync(join(pack, "grammar", "port.ts"), "export {};\n");
  writeFileSync(
    join(pack, "upstream.json"),
    JSON.stringify({ languageServer: PIN }),
  );
  return root;
}

const sig = (name: string, deprecated = false) => ({
  parameters: [{ name, type: "String" }],
  returns: "void",
  varargs: false,
  deprecated,
});

const RAW_SCRIPT = {
  directives: [
    {
      name: "memory",
      description: "    Memory.\n    More.\n",
      deprecated: false,
      signatures: [sig("b"), sig("a")],
    },
    { name: "cpus", description: "", deprecated: false, signatures: [] },
  ],
  processSections: { inputs: [], outputs: [], typedOutputs: [], stage: [] },
  agentDirectives: [],
  operators: [
    {
      name: "map",
      receiver: "Value",
      description: "x",
      deprecated: false,
      signatures: [],
    },
    {
      name: "map",
      receiver: "Channel",
      description: "x",
      deprecated: false,
      signatures: [sig("old", true)],
    },
  ],
  factories: [],
  constants: [],
  functions: [],
  namespaces: [],
  types: [],
  featureFlags: [],
};

describe("gen:catalogue", () => {
  it("ADR-0005: gen:catalogue maps 26.10 to packages/lang-2610 and reads the language server pin", () => {
    const root = fakeRepo();
    const pack = packDir("26.10", root);
    expect(pack).toBe(join(root, "packages", "lang-2610"));
    expect(readPin(pack)).toEqual(PIN);
    expect(() => packDir("99.99", root)).toThrow(/26\.10/);
    expect(() => readPin(join(root, "packages", "nope"))).toThrow(
      /upstream\.json/,
    );
  });

  it("ADR-0005: a jar whose SHA-256 differs from the pin is rejected, naming both hashes", () => {
    const cache = temp();
    mkdirSync(join(cache, PIN.tag), { recursive: true });
    writeFileSync(join(cache, PIN.tag, "language-server-all.jar"), "not a jar");
    let message = "";
    try {
      ensureJar(PIN, cache);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(PIN.sha256);
    expect(message).toMatch(/[0-9a-f]{64}/);
    expect(message.match(/[0-9a-f]{64}/g)?.length).toBe(2);
  });

  it("ADR-0005: normalise and serialise are deterministic (sorted, two-space JSON, trailing newline)", () => {
    const shuffled = structuredClone(RAW_SCRIPT);
    shuffled.operators.reverse();
    shuffled.directives.reverse();
    const first = serialise(normalise(RAW_SCRIPT, SOURCE, "script"));
    const second = serialise(normalise(shuffled, SOURCE, "script"));
    expect(second).toBe(first);
    expect(first.endsWith("}\n")).toBe(true);
    expect(first).toContain('\n  "source": {');
    const out = normalise(RAW_SCRIPT, SOURCE, "script") as unknown as {
      directives: {
        name: string;
        description: string;
        signatures: { parameters: { name: string }[] }[];
      }[];
      operators: { name: string; receiver: string; deprecated: boolean }[];
    };
    expect(out.directives.map((d) => d.name)).toEqual(["cpus", "memory"]);
    expect(out.directives[1]?.description).toBe("Memory.\nMore.");
    expect(out.operators.map((o) => o.receiver)).toEqual(["Channel", "Value"]);
    // deprecated on an entry means every signature is deprecated.
    expect(out.operators[0]?.deprecated).toBe(true);
    expect(out.operators[1]?.deprecated).toBe(false);
  });

  it("ADR-0005: --check fails on a hand edit and says to regenerate, never hand-edit", () => {
    const root = fakeRepo();
    const extract = () => ({
      script: RAW_SCRIPT,
      config: [
        { kind: "option", name: "x", description: " d ", types: ["String"] },
      ],
    });
    const io = { repoRoot: root, extract };
    expect(main(["26.10"], io)).toBe(0);
    const dir = join(root, "packages", "lang-2610", "catalogue");
    const file = join(dir, "script.json");
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    expect(main(["26.10", "--check"], io)).toBe(0);
    writeFileSync(file, `${readFileSync(file, "utf8")} `);
    const errors: string[] = [];
    const original = console.error;
    console.error = (line: string) => errors.push(String(line));
    try {
      expect(main(["26.10", "--check"], io)).toBe(1);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain(
      "catalogue/script.json differs from the generator output; never hand-edit it, run pnpm gen:catalogue 26.10",
    );
  });

  it("ADR-0005: a missing java gives an actionable message", () => {
    const out = temp();
    expect(() => runExtractor("/nonexistent.jar", out, { PATH: out })).toThrow(
      /install a JDK 17\+ \(java on PATH\)/,
    );
  });
});
