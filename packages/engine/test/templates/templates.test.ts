import type { CallNode, ChainNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { createProjector } from "../../src/projection/project";
import { createEngineService } from "../../src/service/service";
import {
  BLANK_TEMPLATE,
  loadTemplateSet,
  templateFiles,
  templateList,
} from "../../src/templates";
import { diagnoseFiles } from "../diagnostics/open";

const version = installedPackVersions()[0] as string;

const SAMPLESHEET_NODES = [
  { id: "main.nf#/:params", kind: "params", typed: null },
  { id: "main.nf#/fastqc", kind: "call", typed: true },
  { id: "main.nf#/reports", kind: "chain", typed: null },
  { id: "main.nf#/multiqc_report", kind: "call", typed: true },
  { id: "main.nf#/channel.topic@1", kind: "factory", typed: null },
  { id: "main.nf#/versions", kind: "chain", typed: null },
  { id: "main.nf#/:output", kind: "output", typed: null },
];

/** The expected nodes of each template's entry workflow; e2e/templates.ts repeats these for the canvas (F-203 task 8). */
const TEMPLATE_NODES: Record<
  string,
  readonly { id: string; kind: string; typed: boolean | null }[]
> = {
  blank: [{ id: "main.nf#/:params", kind: "params", typed: null }],
  "hello-world": [
    { id: "main.nf#/:params", kind: "params", typed: null },
    { id: "main.nf#/greetings", kind: "factory", typed: null },
    { id: "main.nf#/greeting_file", kind: "call", typed: true },
    { id: "main.nf#/:output", kind: "output", typed: null },
  ],
  "samplesheet-multiqc": SAMPLESHEET_NODES,
};

async function everyTemplate() {
  const set = await loadTemplateSet(version);
  return [set.blank, ...set.templates];
}

describe("F-203 engine templates", () => {
  it("F-203 LA-11 LA-40 LA-43 LA-44: each template opens with no parse problem and no diagnostic of any severity", async () => {
    for (const t of await everyTemplate()) {
      const files = await templateFiles(version, t.id);
      const { model, diagnoser } = await diagnoseFiles(files);
      expect(model.diagnostics(), t.id).toEqual([]);
      expect(diagnoser.all(), t.id).toEqual([]);
    }
  });

  it("F-203 step 1 LA-11 UX-23: each template's entry workflow projects the expected nodes, and every call's callee is typed", async () => {
    const pack = installedPacks[0];
    if (!pack) throw new Error("no pack");
    const catalogue = await pack.loadCatalogue();
    for (const t of await everyTemplate()) {
      const { model } = await diagnoseFiles(await templateFiles(version, t.id));
      const projector = createProjector(model, catalogue.script, {
        legacyOperators: pack.legacyOperators,
      });
      const projection = projector.project("main.nf", null);
      expect(projection, t.id).not.toBeNull();
      const nodes = projection?.nodes ?? [];
      expect(
        nodes.map((n) => ({
          id: n.id,
          kind: n.kind,
          typed: n.kind === "call" ? (n as CallNode).callee.typed : null,
        })),
        t.id,
      ).toEqual(TEMPLATE_NODES[t.id]);
      for (const n of nodes.filter((x): x is CallNode => x.kind === "call")) {
        expect(n.callee.typed, `${t.id} ${n.id}`).toBe(true);
      }
    }
  });

  it("F-203 LA-41: Samplesheet to MultiQC's FASTQC takes and emits records", async () => {
    const pack = installedPacks[0];
    if (!pack) throw new Error("no pack");
    const catalogue = await pack.loadCatalogue();
    const { model } = await diagnoseFiles(
      await templateFiles(version, "samplesheet-multiqc"),
    );
    const projector = createProjector(model, catalogue.script, {
      legacyOperators: pack.legacyOperators,
    });
    const nodes = projector.project("main.nf", null)?.nodes ?? [];
    const call = nodes.find((n) => n.id === "main.nf#/fastqc") as CallNode;
    expect(call.inputs[0]?.label).toBe("record(id, fastq_1, fastq_2)");
    expect(call.outputs[0]?.type).toEqual({
      dataflow: "channel",
      element: { name: "Record", args: [], nullable: false },
    });
    const params = nodes.find((n) => n.kind === "params");
    expect(params?.outputs[0]?.type).toEqual({
      dataflow: "channel",
      element: { name: "Sample", args: [], nullable: false },
    });
  });

  it("F-203 LA-44: every chain step in the templates is a known typed operator", async () => {
    const pack = installedPacks[0];
    if (!pack) throw new Error("no pack");
    const catalogue = await pack.loadCatalogue();
    for (const t of await everyTemplate()) {
      const { model } = await diagnoseFiles(await templateFiles(version, t.id));
      const projector = createProjector(model, catalogue.script, {
        legacyOperators: pack.legacyOperators,
      });
      const chains = (projector.project("main.nf", null)?.nodes ?? []).filter(
        (n): n is ChainNode => n.kind === "chain",
      );
      for (const chain of chains) {
        for (const step of chain.steps) {
          expect(step.known, `${t.id} ${step.operator}`).toBe(true);
          expect(
            pack.legacyOperators.some((o) => o.name === step.operator),
            `${t.id} ${step.operator}`,
          ).toBe(false);
        }
      }
    }
  });

  it("F-203 ADR-0003: templates(version) lists blank and the templates without file text, needs no open project, and survives structuredClone; an unknown version rejects", async () => {
    const service = createEngineService();
    const list = await service.templates(version);
    expect(list.version).toBe(version);
    expect(list.blank).toEqual({
      id: "blank",
      name: "Blank",
      description: expect.any(String),
    });
    expect(list.templates.map((t) => t.id)).toEqual(
      (await loadTemplateSet(version)).templates.map((t) => t.id),
    );
    expect(JSON.stringify(list)).not.toContain("nextflow.enable.types");
    expect(structuredClone(list)).toEqual(list);
    expect(await templateList(version)).toEqual(list);
    await expect(service.templates("0.0")).rejects.toThrow(
      "No language pack for 0.0",
    );
  });

  it("F-203 UX-60: BLANK_TEMPLATE resolves to the pack's blank template, whatever its id", async () => {
    const set = await loadTemplateSet(version);
    expect(await templateFiles(version, BLANK_TEMPLATE)).toEqual(
      await templateFiles(version, set.blank.id),
    );
  });

  it("F-203: templateFiles returns the files sorted by path; an unknown id rejects naming the id and version", async () => {
    for (const t of await everyTemplate()) {
      const files = await templateFiles(version, t.id);
      const paths = files.map((f) => f.path);
      expect(paths, t.id).toEqual([...paths].sort());
      expect(paths, t.id).toContain("main.nf");
    }
    await expect(templateFiles(version, "nope")).rejects.toThrow(
      `No template "nope" for Nextflow ${version}`,
    );
  });
});
