// F-601 FI-04: the verified docs page rules.

import type { ConfigNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { configCatalogue } from "../../src/catalogue.ts";
import { configDocsUrl } from "../../src/config/docs.ts";

const BASE = "https://docs.seqera.io/nextflow/";
const url = (...names: string[]) => configDocsUrl(configCatalogue, names);

describe("config docs links", () => {
  it("F-601 FI-04: every catalogue scope and option gets a docs URL under https://docs.seqera.io/nextflow/ by the verified page rules", () => {
    const bad: string[] = [];
    const walk = (nodes: readonly ConfigNode[], prefix: string[]) => {
      for (const node of nodes) {
        const names = [...prefix, node.name];
        const link = url(...names);
        if (link === null || !link.startsWith(BASE))
          bad.push(`${names.join(".")}: ${link}`);
        if ("children" in node && node.kind === "scope")
          walk(node.children, names);
      }
    };
    walk(configCatalogue.scopes, []);
    expect(bad).toEqual([]);
  });

  it("F-601 FI-04: docsUrl gives the verified pages and anchors", () => {
    expect(url("docker", "enabled")).toBe(
      `${BASE}reference/config/docker#dockerenabled`,
    );
    expect(url("process", "memory")).toBe(
      `${BASE}reference/process/directives/memory`,
    );
    expect(url("process", "resourceLimits")).toBe(
      `${BASE}reference/process/directives/resource-limits`,
    );
    expect(url("process", "when")).toBe(`${BASE}config#process-configuration`);
    expect(url("cleanup")).toBe(`${BASE}reference/config/unscoped#cleanup`);
    expect(url("executor", "retry", "delay")).toBe(
      `${BASE}reference/config/executor#executorretrydelay`,
    );
    expect(url("appleContainer")).toBe(
      `${BASE}reference/config/apple-container`,
    );
    expect(url("manifest", "name")).toBe(
      `${BASE}reference/config/manifest#manifestname`,
    );
    expect(url("wave", "build", "cacheRepository")).toBe(
      `${BASE}reference/config/wave#wavebuildcacherepository`,
    );
    expect(url("params")).toBe(`${BASE}config#parameters`);
    expect(url("profiles")).toBe(`${BASE}config#config-profiles`);
    expect(url("plugins")).toBe(`${BASE}plugins`);
    expect(url("process")).toBe(`${BASE}config#process-configuration`);
    expect(url("mystery", "level")).toBeNull();
  });
});
