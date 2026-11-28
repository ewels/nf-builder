import type { ScriptSourceFile } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import type { EditState } from "../../src/edit/apply";
import { applyPatches } from "../../src/edit/patches";
import { declarationSource } from "../../src/form/declaration-text";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const MODULE = "modules/local/greet/main.nf";
const GREET = `/**
 * Writes a greeting.
 */
process GREET {
    input:
    name: String

    output:
    text: Path = file('greeting.txt')

    script:
    """
    echo 'Hello \${name}' > greeting.txt
    """
}`;
const OTHER = `process OTHER {
    input:
    x: String

    output:
    y: String = x

    exec:
    y = x
}`;
const MODULE_TEXT = `nextflow.enable.types = true

include { SOMETHING } from './something.nf'

${GREET}

${OTHER}
`;
const MAIN = `nextflow.enable.types = true

include { GREET } from './modules/local/greet/main.nf'

workflow {
    greet = GREET('world')
    greet.view()
}
`;

const start = (module = MODULE_TEXT, main = MAIN) =>
  stateFor({
    "main.nf": main,
    [MODULE]: module,
    "something.nf":
      "nextflow.enable.types = true\n\nprocess SOMETHING {\n    exec:\n    true\n}\n",
  });

const replace = (text: string, name = "GREET") =>
  ({ kind: "replaceDeclaration", path: MODULE, name, text }) as const;

const spanOf = (state: EditState, name = "GREET") => {
  const file = state.model.file(MODULE);
  return declarationSource(
    file?.source as ScriptSourceFile,
    file?.declarations.get(name)?.declaration as never,
  );
};

describe("F-304 ReplaceDeclaration", () => {
  it("F-304 UX-44 AR-22: only the declaration's span changes; every other declaration and include is byte-identical", async () => {
    const state = await start();
    const text = GREET.replace("Writes a greeting.", "Says hello.").replace(
      "    input:",
      "    cpus 2\n\n    input:",
    );
    const result = accepted(state, replace(text));
    const after = result.files.find((f) => f.path === MODULE)?.text as string;
    expect(after).toBe(MODULE_TEXT.replace(GREET, text));
    expect(result.files.map((f) => f.path)).toEqual([MODULE]);
    expect(after).toContain("include { SOMETHING } from './something.nf'");
    expect(after).toContain(OTHER);
  });

  it("F-304 AR-24: text that doesn't parse is refused with problems and nothing changes", async () => {
    const state = await start();
    const before = texts(state);
    const result = refused(state, replace(GREET.replace("}", "")));
    expect(result.code).toBe("invalid");
    expect(result.problems.length).toBeGreaterThan(0);
    expect(texts(state)).toEqual(before);
    // problems are in the file's lines
    const first = spanOf(state);
    const startLine = MODULE_TEXT.slice(0, first.start).split("\n").length;
    expect(
      Math.min(...result.problems.map((p) => p.line)),
    ).toBeGreaterThanOrEqual(startLine);
  });

  it("F-304: a different name is refused (the store renames first)", async () => {
    const state = await start();
    const result = refused(state, replace(GREET.replace("GREET", "SAY")));
    expect(result.message).toMatch(/SAY/);
  });

  it("F-304 LA-13 UX-42: a legacy process in place of a typed one is refused", async () => {
    const state = await start();
    refused(
      state,
      replace(
        "process GREET {\n    input:\n    val name\n\n    script:\n    'true'\n}",
      ),
    );
    refused(state, replace("workflow GREET {\n}"));
    refused(state, replace(`${GREET}\n\n${OTHER.replace("OTHER", "MORE")}`));
  });

  it("F-304: a missing declaration or file is refused", async () => {
    const state = await start();
    refused(state, replace(GREET, "NOPE"));
    refused(state, { ...replace(GREET), path: "nope.nf" });
  });

  it("F-304: CRLF files keep CRLF; unchanged text gives no patch", async () => {
    const state = await start(MODULE_TEXT.replace(/\n/g, "\r\n"));
    const unchanged = accepted(state, replace(spanOf(state).text));
    expect(unchanged.patches).toEqual([]);
    const result = accepted(
      state,
      replace(GREET.replace("Writes a greeting.", "Says hello.")),
    );
    const after = result.files.find((f) => f.path === MODULE)?.text as string;
    expect(after).toContain("Says hello.");
    expect(after.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(after).not.toMatch(/[^\r]\n/);
  });

  it("F-304 AR-23: the inverse restores the bytes", async () => {
    const state = await start();
    const before = texts(state);
    const result = accepted(
      state,
      replace(GREET.replace("Writes a greeting.", "Says hello.")),
    );
    commit(state, result);
    expect(texts(state)[MODULE]).not.toBe(MODULE_TEXT);
    const undone = applyPatches(new Map(Object.entries(texts(state))), [
      ...result.inverse,
    ]);
    expect(Object.fromEntries(undone.files)).toEqual(before);
  });

  it("F-304 UX-44 ADR-0039: a call passes what the changed inputs take, matched by input name", async () => {
    const state = await start(
      MODULE_TEXT,
      MAIN.replace("GREET('world')", "GREET('world')"),
    );
    const text = GREET.replace(
      "    name: String\n",
      "    punctuation: String?\n    name: String\n",
    );
    const result = accepted(state, replace(text));
    const main = result.files.find((f) => f.path === "main.nf")?.text;
    expect(main).toContain("GREET(null, 'world')");
  });

  it("F-304 ADR-0039: a pipe into a process whose inputs changed is refused", async () => {
    const state = await start(
      MODULE_TEXT,
      MAIN.replace("greet = GREET('world')", "greet = channel.of('a') | GREET"),
    );
    const text = GREET.replace(
      "    name: String\n",
      "    name: String\n    more: String\n",
    );
    const result = refused(state, replace(text));
    expect(result.message).toMatch(/pipe/);
  });

  it("F-304 ADR-0039: a renamed input counts as removed and added, so its call argument becomes null", async () => {
    const state = await start();
    const result = accepted(
      state,
      replace(GREET.replace("name: String", "who: String")),
    );
    const main = result.files.find((f) => f.path === "main.nf")?.text;
    expect(main).toContain("GREET(null)");
  });

  it("F-304 ADR-0039: the pipe refusal from the Code tab doesn't send the user back to the Code tab", async () => {
    const state = await start(
      MODULE_TEXT,
      MAIN.replace("greet = GREET('world')", "greet = channel.of('a') | GREET"),
    );
    const text = GREET.replace(
      "    name: String\n",
      "    name: String\n    more: String\n",
    );
    const result = refused(state, replace(text));
    expect(result.message).not.toMatch(/Code tab/);
    expect(result.message).toMatch(/pipe/);
  });

  it("F-304 F-303: outputs renamed in place (two or more) are followed at call sites; a moved or added output leaves them", async () => {
    const two = `process PAIR {
    input:
    x: String

    output:
    left: String = x
    right: String = x

    exec:
    true
}`;
    const caller = `nextflow.enable.types = true

include { PAIR } from './modules/local/greet/main.nf'

workflow {
    r = PAIR('a')
    r.left.view()
    r.right.view()
}
`;
    const module = `nextflow.enable.types = true\n\n${two}\n`;
    const state = await start(module, caller);
    const renamed = accepted(
      state,
      replace(two.replace("left:", "first:"), "PAIR"),
    );
    const main = renamed.files.find((f) => f.path === "main.nf")?.text;
    expect(main).toContain("r.first.view()");
    expect(main).toContain("r.right.view()");
    // an added output is not a rename: reads stay as they were
    const added = accepted(
      state,
      replace(
        two
          .replace("left:", "first:")
          .replace(
            "    right: String = x\n",
            "    right: String = x\n    third: String = x\n",
          ),
        "PAIR",
      ),
    );
    const after = added.files.find((f) => f.path === "main.nf")?.text;
    expect(after ?? caller).toContain("r.left.view()");
  });
});
