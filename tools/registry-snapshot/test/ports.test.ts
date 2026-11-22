import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { ApiModuleChannel } from "../src/api-types.ts";
import { metaYmlOutputNames, modulePorts } from "../src/ports.ts";
import { recordedBundleText, recordedModule } from "./support/recorded.ts";

/** A test-local reader of the nf-core nested meta.yml dialect: a channel is one item map, or a list of them (a tuple). */
function channelPort(channel: unknown): string | string[] {
  const item = (entry: unknown): string => {
    const [name] = Object.keys(entry as object);
    return `${name}:${(entry as Record<string, { type?: string }>)[name as string]?.type ?? ""}`;
  };
  return Array.isArray(channel) ? channel.map(item) : item(channel);
}

const channel = (
  items: { name?: string; type?: string }[],
  tuple?: boolean,
): ApiModuleChannel => ({ items, tuple });

describe("F-501 ports", () => {
  it("F-501 step 3 LA-23: nf-core/fastqc ports match its meta.yml", async () => {
    const module = await recordedModule("nf-core/fastqc");
    const metaYml =
      (await recordedBundleText("nf-core/fastqc", "0.0.0-6d1763b")).get(
        "meta.yml",
      ) ?? "";
    const ports = modulePorts(module.latest?.metadata, metaYml);
    expect(ports).toEqual({
      inputs: [["meta:map", "reads:file"]],
      outputs: [
        { name: "html", port: ["meta:map", "*.html:file"] },
        { name: "zip", port: ["meta:map", "*.zip:file"] },
        {
          name: "versions_fastqc",
          port: [
            "${task.process}:string",
            "fastqc:string",
            'fastqc --version | sed "/FastQC v/!d; s/.*v//":eval',
          ],
        },
      ],
    });
    // Independently, from the YAML.
    const yaml = parse(metaYml) as {
      input: unknown[];
      output: Record<string, unknown[]>;
    };
    expect(ports.inputs).toEqual(yaml.input.map(channelPort));
    expect(ports.outputs).toEqual(
      Object.entries(yaml.output).map(([name, value]) => ({
        name,
        port: channelPort(value[0]),
      })),
    );
  });

  it("F-501 LA-23: outputs follow meta.yml order, not the API's", () => {
    const metadata = {
      output: {
        zip: channel([{ name: "z", type: "file" }]),
        html: channel([{ name: "h", type: "file" }]),
        extra: channel([]),
      },
    };
    const ports = modulePorts(metadata, "output:\n  html: []\n  zip: []\n");
    expect(ports.outputs.map((o) => o.name)).toEqual(["html", "zip", "extra"]);
    expect(modulePorts(metadata, null).outputs.map((o) => o.name)).toEqual([
      "zip",
      "html",
      "extra",
    ]);
  });

  it("F-501: list-form meta.yml outputs keep position; synthetic output_<n> names become null", async () => {
    const module = await recordedModule("nextflow-io/hello");
    const metaYml =
      (await recordedBundleText("nextflow-io/hello", "1.0.0")).get(
        "meta.yml",
      ) ?? "";
    expect(metaYmlOutputNames(metaYml)).toEqual(["output_1"]);
    expect(modulePorts(module.latest?.metadata, metaYml)).toEqual({
      inputs: ["greeting:string"],
      outputs: [{ name: null, port: ":string" }],
    });
    expect(
      metaYmlOutputNames(
        "output:\n  - html:\n      - []\n  - name: zip\n  - type: file\n",
      ),
    ).toEqual(["html", "zip", "output_3"]);
    expect(metaYmlOutputNames("name: x\n")).toEqual([]);
  });

  it("F-501: a missing item name or type is an empty string, never dropped", () => {
    const ports = modulePorts(
      { input: [channel([{ type: "file" }, { name: "x" }, {}], true)] },
      null,
    );
    expect(ports.inputs).toEqual([[":file", "x:", ":"]]);
  });

  it("F-501: a single-item tuple stays an array", () => {
    const ports = modulePorts(
      {
        input: [
          channel([{ name: "a", type: "val" }], true),
          channel([{ name: "b", type: "val" }], false),
          channel([{ name: "c" }, { name: "d" }]),
        ],
      },
      null,
    );
    expect(ports.inputs).toEqual([["a:val"], "b:val", ["c:", "d:"]]);
  });

  it("F-501: missing metadata gives no ports", () => {
    expect(modulePorts(undefined, null)).toEqual({ inputs: [], outputs: [] });
  });
});
