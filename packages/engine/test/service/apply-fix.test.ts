import { readFileSync } from "node:fs";
import type { QuickFix } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  type ApplyOutcome,
  createEngineService,
  type EngineApi,
  type EngineRefusal,
  type HistoryOutcome,
} from "../../src";
import { installedPackVersions } from "../../src/packs";
import { readTree } from "../model/read-tree";

const version = installedPackVersions()[0] as string;
const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const problems = () => readTree(`${cases}f309-problems`);
const fixedMain = readFileSync(`${cases}f309-problems-fixed/main.nf`, "utf8");
const module = "modules/local/legacy_count/main.nf";

async function start() {
  const service: EngineApi = createEngineService();
  const summary = await service.open({ version, files: problems() });
  const diagnosed = async () => {
    const r = await service.diagnostics();
    if (!("diagnostics" in r)) throw new Error("refused");
    return r;
  };
  const { diagnostics, revision } = await diagnosed();
  const fix = diagnostics.find((d) => d.fix)?.fix as QuickFix;
  return { service, summary, revision, fix, diagnosed };
}

const refused = (r: ApplyOutcome | HistoryOutcome): EngineRefusal => {
  if (r.ok) throw new Error("expected a refusal");
  return r;
};

describe("F-309 applyFix", () => {
  it("F-309 step 2 ADR-0042 AR-05: applyFix applies the deprecated-channel fix as one ReplaceFileText; main.nf equals f309-problems-fixed byte for byte and the next diagnostics have no warning", async () => {
    const { service, revision, fix, diagnosed } = await start();
    const r = await service.applyFix(fix, revision);
    if (!r.ok) throw new Error(r.message);
    expect(r.revision).toBe(revision + 1);
    expect(r.files).toEqual([{ path: "main.nf", text: fixedMain }]);
    expect(r.patches).toHaveLength(1);
    expect(await service.readFile("main.nf")).toBe(fixedMain);
    const next = await diagnosed();
    expect(next.revision).toBe(revision + 1);
    expect(next.diagnostics.map((d) => d.severity)).toEqual([
      "suggestion",
      "suggestion",
    ]);
  });

  it("F-309 ADR-0042: a fix is refused as stale once its file changed after the diagnosed revision, and still applies after a change to another file", async () => {
    const { service, revision, fix } = await start();
    const other = await service.apply(
      {
        kind: "replaceFileText",
        path: module,
        text: `${readFileSync(`${cases}f309-problems/${module}`, "utf8")}// x\n`,
      },
      revision,
    );
    if (!other.ok) throw new Error(other.message);
    const ok = await service.applyFix(fix, revision);
    expect(ok.ok).toBe(true);

    const second = await start();
    const own = await second.service.apply(
      {
        kind: "replaceFileText",
        path: "main.nf",
        text: `// c\n${problems().find((f) => f.path === "main.nf")?.text}`,
      },
      second.revision,
    );
    if (!own.ok) throw new Error(own.message);
    const before = await second.service.readFile("main.nf");
    const r = refused(
      await second.service.applyFix(second.fix, second.revision),
    );
    expect(r.code).toBe("stale");
    expect(r.message).toContain("main.nf");
    expect(await second.service.readFile("main.nf")).toBe(before);
    expect(r.revision).toBe(own.revision);
  });

  it("F-309 ADR-0039 AR-24: a fix whose result doesn't parse is refused with does-not-parse and changes nothing", async () => {
    const { service, revision } = await start();
    const before = await service.readFile("main.nf");
    const r = refused(
      await service.applyFix(
        {
          title: "Break it",
          path: "main.nf",
          edits: [{ start: 0, end: 7, text: "include {{{ (" }],
        },
        revision,
      ),
    );
    expect(r.code).toBe("does-not-parse");
    expect(await service.readFile("main.nf")).toBe(before);
    expect(r.revision).toBe(revision);
  });

  it("F-309: applyFix refuses an unknown path (not-found), edits outside the text (invalid), a revision from before the open or after the current one (stale), and no project (no-project)", async () => {
    const { service, revision, fix } = await start();
    const edit = { start: 0, end: 1, text: "x" };
    expect(
      refused(
        await service.applyFix(
          { title: "t", path: "nope.nf", edits: [edit] },
          revision,
        ),
      ).code,
    ).toBe("not-found");
    expect(
      refused(
        await service.applyFix(
          {
            title: "t",
            path: "main.nf",
            edits: [{ start: 0, end: 99999, text: "" }],
          },
          revision,
        ),
      ).code,
    ).toBe("invalid");
    expect(refused(await service.applyFix(fix, revision + 1)).code).toBe(
      "stale",
    );
    expect(refused(await service.applyFix(fix, revision - 1)).code).toBe(
      "stale",
    );
    // a revision from before a later open
    const summary = await service.open({ version, files: problems() });
    expect(summary.revision).toBeGreaterThan(revision);
    expect(refused(await service.applyFix(fix, revision)).code).toBe("stale");
    await service.close();
    expect(refused(await service.applyFix(fix, summary.revision)).code).toBe(
      "no-project",
    );
  });

  it("F-309 F-209 AR-23: an applied fix is one undo step labelled with the fix title; undo restores main.nf byte for byte", async () => {
    const { service, revision, fix } = await start();
    const original = await service.readFile("main.nf");
    const r = await service.applyFix(fix, revision);
    if (!r.ok) throw new Error(r.message);
    expect(r.history.undoCount).toBe(1);
    expect(r.history.undo).toBe(fix.title);
    const u = await service.undo(r.revision);
    if (!u.ok) throw new Error(u.message);
    expect(u.label).toBe(fix.title);
    expect(await service.readFile("main.nf")).toBe(original);
    // an explicit label wins
    const again = await service.applyFix(fix, u.revision, { label: "Fix it" });
    if (!again.ok) throw new Error("refused");
    expect(again.history.undo).toBe("Fix it");
  });

  it("F-309 ADR-0003: applyFix results survive structuredClone", async () => {
    const { service, revision, fix } = await start();
    const bad = await service.applyFix(fix, revision + 5);
    expect(structuredClone(bad)).toEqual(bad);
    const ok = await service.applyFix(fix, revision);
    expect(structuredClone(ok)).toEqual(ok);
  });
});
