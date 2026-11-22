import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pack } from "@nf-builder/lang-2610";
import type { SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { classifyModule } from "../src/classify.ts";
import { recordedBundleText, recordedModule } from "./support/recorded.ts";

const toolDir = fileURLToPath(new URL("..", import.meta.url));
let parser: SourceParser;
beforeAll(async () => {
  parser = await pack.loadParser();
});

describe("F-501 classification", () => {
  it("F-501 step 3 IO-31: nf-core/fastqc is a legacy process named FASTQC", async () => {
    const mainNf =
      (await recordedBundleText("nf-core/fastqc", "0.0.0-6d1763b")).get(
        "main.nf",
      ) ?? null;
    const metadata = (await recordedModule("nf-core/fastqc")).latest?.metadata;
    expect(
      classifyModule(parser, mainNf, {
        kind: metadata?.kind,
        componentName: metadata?.componentName,
      }),
    ).toEqual({
      kind: "process",
      component: "FASTQC",
      typed: false,
    });
  });

  it("F-501 IO-31: nextflow-io/hello is a typed process HELLO although the registry gives no componentName", async () => {
    const mainNf =
      (await recordedBundleText("nextflow-io/hello", "1.0.0")).get("main.nf") ??
      null;
    const metadata = (await recordedModule("nextflow-io/hello")).latest
      ?.metadata;
    expect(metadata?.componentName).toBeUndefined();
    expect(classifyModule(parser, mainNf, { kind: metadata?.kind })).toEqual({
      kind: "process",
      component: "HELLO",
      typed: true,
    });
  });

  it("F-501 IO-31: the parsed kind wins over the registry's", () => {
    const text = "workflow WF {\n  main:\n  println 'hi'\n}\n";
    expect(classifyModule(parser, text, { kind: "Process" })).toEqual({
      kind: "workflow",
      component: "WF",
      typed: false,
    });
  });

  it("F-501 ADR-0004: an unmodellable main.nf gives typed null, kind and component from the registry", () => {
    const junk = "this is {{{ not nextflow ]]\n";
    expect(
      classifyModule(parser, junk, { kind: "Workflow", componentName: "WF" }),
    ).toEqual({ kind: "workflow", component: "WF", typed: null });
    expect(classifyModule(parser, null, { kind: "Process" })).toEqual({
      kind: "process",
      component: null,
      typed: null,
    });
  });

  it("F-501: picks the declaration named componentName among several", () => {
    const text =
      "process A {\n  script:\n  'true'\n}\n\nprocess B {\n  script:\n  'true'\n}\n";
    expect(
      classifyModule(parser, text, { kind: "Process", componentName: "B" })
        .component,
    ).toBe("B");
    // Several and none named: nothing qualifies.
    expect(classifyModule(parser, text, { kind: "Process" })).toEqual({
      kind: "process",
      component: null,
      typed: null,
    });
  });

  it("F-501: the pack's parser loads and parses under plain Node type stripping", () => {
    const script = `
      import { pack } from "@nf-builder/lang-2610";
      const parser = await pack.loadParser();
      const parse = parser.parseScript("process FOO {\\n  script:\\n  'true'\\n}\\n");
      console.log(JSON.stringify({ status: parse.status, name: parse.ast?.body[0]?.name?.name }));
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: toolDir, encoding: "utf8" },
    );
    expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "modelled",
      name: "FOO",
    });
  });
});
