import { join } from "node:path";
import type { EditCommand, WorkflowTarget } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { applyPatches } from "../../src/edit/patches";
import { readTree } from "../model/read-tree";
import {
  accepted,
  commit,
  projection,
  refused,
  stateFor,
  texts,
} from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const fixture = () =>
  Object.fromEntries(
    readTree(join(cases, "f307-workflow-tabs")).map((f) => [f.path, f.text]),
  );

const alignPath = "subworkflows/local/align/main.nf";
const sortPath = "subworkflows/local/sort/main.nf";
const align: WorkflowTarget = { path: alignPath, workflow: "ALIGN" };
const sort: WorkflowTarget = { path: sortPath, workflow: "SORT" };
const entry: WorkflowTarget = { path: "main.nf", workflow: null };

const take = (
  target: WorkflowTarget,
  name: string,
  type: string | null,
): EditCommand => ({ kind: "addTake", target, name, type });
const emit = (
  target: WorkflowTarget,
  name: string,
  type: string | null,
): EditCommand => ({ kind: "addEmit", target, name, type });

const legacy =
  "workflow ONE {\n    main:\n    channel.of(1).view()\n}\n\nworkflow TWO {\n    take:\n    reads\n\n    main:\n    reads.view()\n\n    emit:\n    only = reads\n}\n\nworkflow EMPTY {\n}\n";

describe("F-307 AddTake", () => {
  it("F-307 step 2 UX-51 AR-21: AddTake appends a typed take and every call site's projection gains the input port", async () => {
    const state = await stateFor(fixture());
    const before = texts(state);
    const r = accepted(state, take(align, "index", "Channel<String>"));
    expect(r.files.map((f) => f.path)).toEqual([alignPath]);
    const after = r.files[0]?.text as string;
    expect(after).toContain(
      "    reads: Channel<String>\n    index: Channel<String>\n",
    );
    // AR-22: nothing else changed
    expect(after.replace("    index: Channel<String>\n", "")).toBe(
      before[alignPath],
    );
    commit(state, r);
    const main = projection(state);
    for (const label of ["ALIGN", "MAP"]) {
      const call = main.nodes.find(
        (n) => n.kind === "call" && n.label === label,
      );
      expect(
        call?.inputs.map((p) => p.id),
        label,
      ).toEqual(["reads", "index"]);
      expect(call?.inputs[1]?.argument, label).toBeNull();
    }
  });

  it("F-307 UX-51: AddTake creates take: when absent, before main:; legacy workflows get an untyped take", async () => {
    const state = await stateFor({ "legacy.nf": legacy });
    const r = accepted(
      state,
      take({ path: "legacy.nf", workflow: "ONE" }, "reads", null),
    );
    expect(r.files[0]?.text).toBe(
      "workflow ONE {\n    take:\n    reads\n\n    main:\n    channel.of(1).view()\n}\n\n" +
        legacy.split(
          "workflow ONE {\n    main:\n    channel.of(1).view()\n}\n\n",
        )[1],
    );
    const typed = await stateFor({
      "main.nf":
        "nextflow.enable.types = true\n\nworkflow W {\n    main:\n    ch = channel.of(1)\n}\n",
    });
    const t = accepted(
      typed,
      take({ path: "main.nf", workflow: "W" }, "x", "Value<Integer>"),
    );
    expect(t.files[0]?.text).toBe(
      "nextflow.enable.types = true\n\nworkflow W {\n    take:\n    x: Value<Integer>\n\n    main:\n    ch = channel.of(1)\n}\n",
    );
  });

  it("F-307 AR-21 AR-24: AddTake refuses the entry workflow, a bad or taken name, a builtin, a type on legacy, no type on typed, an unparsable type, and a body with neither main nor emit", async () => {
    const state = await stateFor({ ...fixture(), "legacy.nf": legacy });
    const before = texts(state);
    const legacyOne = { path: "legacy.nf", workflow: "ONE" };
    const cases: [EditCommand, string][] = [
      [take(entry, "x", "Channel<String>"), "entry workflow has no take"],
      [take(align, "1x", "Channel<String>"), "isn't a valid"],
      [take(align, "a-b", "Channel<String>"), "isn't a valid"],
      [take(align, "reads", "Channel<String>"), "already used"],
      [take(align, "sorted", "Channel<String>"), "already used"],
      [take(align, "params", "Channel<String>"), "built-in"],
      [take(legacyOne, "x", "Channel<String>"), "legacy"],
      [take(align, "x", null), "needs a type"],
      [take(align, "x", "Channel<"), "isn't a type"],
      [take(align, "x", "Channel<String>\n    main:"), "isn't a type"],
      [
        take({ path: "legacy.nf", workflow: "EMPTY" }, "x", null),
        "Add a step or an emit to EMPTY first",
      ],
    ];
    for (const [command, message] of cases) {
      const r = refused(state, command);
      expect(r.code, message).toBe("invalid");
      expect(r.message, message).toContain(message);
    }
    expect(texts(state)).toEqual(before);
  });
});

describe("F-307 AddEmit", () => {
  it("F-307 UX-51 AR-21: AddEmit appends name: Type = null (typed) or name = null (legacy); the call's output ports gain it", async () => {
    const state = await stateFor({ ...fixture(), "legacy.nf": legacy });
    const l = accepted(
      state,
      emit({ path: "legacy.nf", workflow: "EMPTY" }, "extra", null),
    );
    expect(l.files[0]?.text).toContain(
      "workflow EMPTY {\n\n    emit:\n    extra = null\n}\n",
    );
    const r = accepted(state, emit(sort, "extra", "Channel<String>"));
    const after = r.files[0]?.text as string;
    expect(after).toContain(
      "    report: Channel<String> = report\n    extra: Channel<String> = null\n}\n",
    );
    commit(state, r);
    const inAlign = projection(state, alignPath, "ALIGN");
    const call = inAlign.nodes.find(
      (n) => n.kind === "call" && n.label === "SORT",
    );
    expect(call?.outputs.map((p) => p.id)).toEqual([
      "sorted",
      "report",
      "extra",
    ]);
  });

  it("F-307 UX-51: AddEmit refuses a workflow with exactly one emit", async () => {
    const state = await stateFor({ ...fixture(), "legacy.nf": legacy });
    const r = refused(state, emit(align, "extra", "Channel<String>"));
    expect(r.code).toBe("invalid");
    expect(r.message).toContain("only emit is read directly at its call sites");
    expect(
      refused(
        state,
        emit({ path: "legacy.nf", workflow: "TWO" }, "extra", null),
      ).message,
    ).toContain("only emit");
    const bad: [EditCommand, string][] = [
      [emit(entry, "x", "Channel<String>"), "entry workflow has no emit"],
      [emit(sort, "9", "Channel<String>"), "isn't a valid"],
      [emit(sort, "sorted", "Channel<String>"), "already used"],
      [emit(sort, "x", null), "needs a type"],
      [emit(sort, "x", "Value<"), "isn't a type"],
      [
        emit({ path: "legacy.nf", workflow: "EMPTY" }, "x", "Value<String>"),
        "legacy",
      ],
    ];
    for (const [command, message] of bad)
      expect(refused(state, command).message, message).toContain(message);
  });
});

describe("F-307 inverses", () => {
  it("F-307 AR-23: AddTake and AddEmit inverses restore the exact bytes", async () => {
    const state = await stateFor({ ...fixture(), "legacy.nf": legacy });
    const before = texts(state);
    const history = [];
    for (const command of [
      take(align, "index", "Channel<String>"),
      emit(sort, "extra", "Channel<String>"),
      take({ path: "legacy.nf", workflow: "ONE" }, "reads", null),
    ]) {
      const r = accepted(state, command);
      commit(state, r);
      history.push(r.inverse);
    }
    let current = new Map(Object.entries(texts(state)));
    for (const inverse of history.reverse())
      current = applyPatches(current, [...inverse]).files;
    expect(Object.fromEntries(current)).toEqual(before);
  });
});
