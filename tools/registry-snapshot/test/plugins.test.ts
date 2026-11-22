import { describe, expect, it } from "vitest";
import type { ApiPlugin } from "../src/api-types.ts";
import { admits, pluginSnapshot } from "../src/plugins.ts";
import { recordedPlugin } from "./support/recorded.ts";

const NEXTFLOW = "26.10.7";
const spec = (definitions: unknown[]) => JSON.stringify({ definitions });
const fn = { type: "Function", spec: { name: "f", parameters: [] } };

describe("F-501 plugins", () => {
  it("F-501 IO-31 IO-33: nf-schema indexes 3.1.0 with its 21 definitions", async () => {
    const result = pluginSnapshot(await recordedPlugin("nf-schema"), NEXTFLOW);
    if ("skipped" in result) throw new Error(result.skipped);
    expect(result.problems).toEqual([]);
    expect(result.entry).toMatchObject({
      id: "nf-schema",
      version: "3.1.0",
      requires: ">=26.04.0",
      provider: "nextflow-io",
      projectUrl: "https://github.com/nextflow-io/nf-schema",
      definitions: 21,
    });
    expect(result.entry.summary).toMatch(
      /^A Nextflow plugin to work with validation/,
    );
    expect(result.entry.summary.length).toBeLessThanOrEqual(300);
    expect(result.file).toMatchObject({
      format: 1,
      id: "nf-schema",
      version: "3.1.0",
      requires: ">=26.04.0",
    });
    expect(result.file.description).toContain("## Summary");
    expect(result.file.definitions).toHaveLength(21);
    expect(result.file.definitions.map((d) => d.type)).toContain("ConfigScope");
  });

  it("F-501 IO-33: the chosen release is the highest published one whose requires admits 26.10.7", () => {
    const plugin: ApiPlugin = {
      id: "nf-azure",
      releases: [
        { version: "1.26.0", requires: ">=26.11.0-edge", status: "PUBLISHED" },
        { version: "1.25.1", requires: ">=26.04.0", status: "REVOKED" },
        { version: "1.25.0", requires: ">=26.11.0-edge", status: "PUBLISHED" },
        {
          version: "1.24.5",
          requires: ">=26.04.0",
          status: "PUBLISHED",
          spec: spec([fn]),
        },
        { version: "1.24.0", requires: ">=25.10.0", status: "PUBLISHED" },
      ],
    };
    const result = pluginSnapshot(plugin, NEXTFLOW);
    expect("entry" in result && result.entry.version).toBe("1.24.5");
  });

  it("F-501: admits handles >=, >, <, bare versions, -edge and -SNAPSHOT", () => {
    const cases: [string | null, boolean][] = [
      [null, true],
      [">=26.04.0", true],
      [">=26.10.7", true],
      [">=26.10.8", false],
      [">=26.11.0-edge", false],
      [">=26.10.7-edge", true],
      [">=26.10.7-SNAPSHOT", true],
      [">=26.10.8-SNAPSHOT", false],
      [">26.10.7", false],
      [">26.10.6", true],
      ["<26.10.7", false],
      ["<26.11.0", true],
      ["<26.11.0-edge", true],
      ["26.04.0", true],
      ["26.10.8", false],
      [">=25.9.0", true],
    ];
    for (const [requires, expected] of cases)
      expect(admits(requires, NEXTFLOW), String(requires)).toBe(expected);
    expect(admits(">=26.10.0", "26.10.0-edge")).toBe(false);
  });

  it("F-501: no spec gives definitions 0; malformed definitions are dropped and reported; no admitted release skips the plugin", async () => {
    const ffq = pluginSnapshot(await recordedPlugin("nf-ffq"), NEXTFLOW);
    expect(ffq).toMatchObject({
      entry: { id: "nf-ffq", version: "0.2.0", definitions: 0, summary: "" },
    });
    expect("file" in ffq && ffq.file.definitions).toEqual([]);

    const messy = pluginSnapshot(
      {
        id: "nf-x",
        releases: [
          {
            version: "1.0.0",
            status: "PUBLISHED",
            spec: spec([
              fn,
              { type: "Bogus", spec: { name: "b" } },
              { type: "Function", spec: {} },
              null,
            ]),
          },
        ],
      },
      NEXTFLOW,
    );
    if ("skipped" in messy) throw new Error(messy.skipped);
    expect(messy.entry.definitions).toBe(1);
    expect(messy.problems).toHaveLength(3);

    const badJson = pluginSnapshot(
      {
        id: "nf-y",
        releases: [{ version: "1.0.0", status: "PUBLISHED", spec: "{nope" }],
      },
      NEXTFLOW,
    );
    expect("problems" in badJson && badJson.problems).toHaveLength(1);

    const none = pluginSnapshot(
      {
        id: "nf-z",
        releases: [
          { version: "2.0.0", requires: ">=27.0.0", status: "PUBLISHED" },
        ],
      },
      NEXTFLOW,
    );
    expect(none).toEqual({ skipped: expect.stringContaining("nf-z") });
    expect(pluginSnapshot({ id: "nf-w", releases: [] }, NEXTFLOW)).toEqual({
      skipped: expect.stringContaining("nf-w"),
    });
  });
});
