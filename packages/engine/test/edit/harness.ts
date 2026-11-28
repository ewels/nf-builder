// The property harness (F-111 plan 4.1): random command sequences against a project, with the invariants of AR-22,
// AR-23, AR-24 and LA-13 checked after each command and the undo check after the sequence.
import {
  type ConfigAst,
  type ConfigContext,
  type ConfigValue,
  EDIT_COMMAND_KINDS,
  type EditCommand,
  MIXED_DEFINITIONS,
  type Projection,
  type ScriptSourceFile,
  type SourceFile,
  type TextEdit,
  type TextPatch,
  type WorkflowDef,
  type WorkflowTarget,
} from "@nf-builder/lang-core";
import * as fc from "fast-check";
import { expect } from "vitest";
import { applyCommand, commit, type EditState } from "../../src/edit/apply";
import { plugins } from "../../src/edit/config/locate";
import { definitionStyles, problemKeys } from "../../src/edit/guards";
import { applyPatches } from "../../src/edit/patches";
import { itemSpan } from "../../src/edit/splice";
import { createProjector } from "../../src/projection/project";
import { diffNodes } from "../../src/source/equivalent";
import { createSourceFile } from "../../src/source/source-file";
import { structure } from "./structure";

export interface Choice {
  kind: number;
  a: number;
  b: number;
  name: string;
  snippet: number;
}

export const choiceArb: fc.Arbitrary<Choice> = fc.record({
  kind: fc.nat(EDIT_COMMAND_KINDS.length - 1),
  a: fc.nat(1000),
  b: fc.nat(1000),
  name: fc.stringMatching(/^[A-Z][A-Z0-9_]{0,7}$/),
  snippet: fc.nat(3),
});

export const sequenceArb = fc.array(choiceArb, { minLength: 1, maxLength: 5 });

/** What happened over a run: accepted commands per kind, refusals per kind and code, and skipped choices. */
export class Stats {
  readonly accepted = new Map<string, number>();
  readonly refused = new Map<string, number>();
  skipped = 0;
  count(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }
}

const SNIPPETS = [
  "process Z {\n    input:\n    val x\n\n    script:\n    'z'\n}\n",
  "}",
  "/*",
  "workflow W {}\n",
];

// what the config kinds are built from: options of the catalogue with a value of their kind, profiles and plugins
const CONFIG_PROFILES = ["test", "ci"];
const CONFIG_OPTIONS: readonly (readonly [readonly string[], ConfigValue])[] = [
  [["process", "cpus"], { kind: "integer", value: 2 }],
  [["docker", "enabled"], { kind: "boolean", value: true }],
  [["process", "memory"], { kind: "memory", amount: 8, unit: "GB" }],
  [["manifest", "name"], { kind: "string", value: "it's" }],
];
const CONFIG_PLUGINS = ["nf-schema@2.5.1", "nf-prov@1.4.0"];

/** The options a config sets at its top level, in blocks or dotted, whose names the form can write. */
function configOptionNames(ast: ConfigAst): string[][] {
  const out: string[][] = [];
  const visit = (
    statements: readonly ConfigAst["statements"][number][],
    prefix: readonly string[],
  ) => {
    for (const s of statements) {
      if (s.kind === "ConfigAssign") {
        const names = [...prefix, ...s.path.map((n) => n.name)];
        if (names.every((n) => /^[A-Za-z_]\w*$/.test(n))) out.push(names);
      } else if (s.kind === "ConfigBlock" && s.name.name !== "profiles")
        visit(s.statements, [...prefix, s.name.name]);
    }
  };
  visit(ast.statements, []);
  return out;
}

const pick = <T>(list: readonly T[], i: number): T | undefined =>
  list.length === 0 ? undefined : list[i % list.length];

export const snapshot = (state: EditState): Map<string, string> =>
  new Map(
    state.model
      .paths()
      .map((p) => [p, state.model.file(p)?.source.text ?? ""] as const),
  );

/** Turns a choice into a command by indexing what the current state offers; null when it offers nothing. */
export function buildCommand(state: EditState, c: Choice): EditCommand | null {
  const kind = EDIT_COMMAND_KINDS[c.kind % EDIT_COMMAND_KINDS.length];
  const paths = state.model.paths();
  const scripts = paths.filter(
    (p) => state.model.file(p)?.source.language === "nextflow",
  );
  const projector = createProjector(state.model, state.catalogue);
  // the workflow at `a`; with `needs`, the first of the next few that offers something to act on
  const workflow = (
    needs: (p: Projection, target: WorkflowTarget) => boolean = () => true,
  ) => {
    const all = projector.workflows().filter((x) => x.modelled);
    for (let i = 0; i < Math.min(all.length, 12); i++) {
      const w = all[(c.a + i) % all.length];
      const projection = w && projector.project(w.path, w.name);
      const target = w && { path: w.path, workflow: w.name };
      if (w && target && projection && needs(projection, target))
        return { target, projection };
    }
    return null;
  };
  switch (kind) {
    case "createProcess": {
      const caller = pick(scripts, c.a);
      return caller ? { kind, name: c.name, caller } : null;
    }
    case "addCall": {
      // Usually a callee that is fine to add: a workflow (Nextflow runs one called twice) or a process the target doesn't
      // call yet (AddCall refuses a second call of a process: `invalid`). One choice in four takes any name in scope, to
      // keep the refusals covered.
      const scopeOf = (path: string) =>
        [...(state.model.file(path)?.scope.keys() ?? [])].sort();
      const addable = (p: Projection, target: WorkflowTarget, n: string) => {
        const called = new Set(p.nodes.map((x) => x.label));
        const b = state.model.lookup(target.path, n);
        const d =
          b?.kind === "declaration" ? b.declaration : b?.entry.declaration;
        return (
          (d?.kind === "Workflow" && n !== target.workflow) ||
          (d?.kind === "Process" && !called.has(n))
        );
      };
      const plain = c.b % 4 === 0;
      const w = workflow(
        plain
          ? undefined
          : (p, target) =>
              scopeOf(target.path).some((n) => addable(p, target, n)),
      );
      if (!w) return null;
      const scope = scopeOf(w.target.path);
      const fresh = scope.filter((n) => addable(w.projection, w.target, n));
      const callee = pick(
        !plain && fresh.length > 0 ? fresh : scope,
        Math.floor(c.b / 4),
      );
      return callee ? { kind, target: w.target, callee } : null;
    }
    case "connect": {
      const w = workflow((p) => p.nodes.some((n) => n.inputs.length > 0));
      if (!w) return null;
      const outs = w.projection.nodes.flatMap((n) =>
        n.outputs.map((p) => ({ node: n.id, port: p.id })),
      );
      const ins = w.projection.nodes.flatMap((n) =>
        n.inputs.map((p) => ({ node: n.id, port: p.id })),
      );
      const from = pick(outs, c.a);
      const to = pick(ins, c.b);
      return from && to ? { kind, target: w.target, from, to } : null;
    }
    case "disconnect": {
      const w = workflow((p) =>
        p.nodes.some(
          (n) =>
            (n.kind === "call" || n.kind === "chain") &&
            n.inputs.some(
              (i) =>
                i.argument !== null && !(n.kind === "chain" && i.id === "in"),
            ),
        ),
      );
      if (!w) return null;
      // fed ports of calls and chains; a chain's receiver, emits and publishers are never disconnected
      const fed = w.projection.nodes.flatMap((n) =>
        n.kind === "call" || n.kind === "chain"
          ? n.inputs
              .filter(
                (p) =>
                  p.argument !== null && !(n.kind === "chain" && p.id === "in"),
              )
              .map((p) => ({ node: n.id, port: p.id }))
          : [],
      );
      const port = pick(fed, c.b);
      return port ? { kind, target: w.target, port } : null;
    }
    case "deleteNode": {
      const w = workflow((p) => p.nodes.length > 0);
      const n = w && pick(w.projection.nodes, c.b);
      return w && n ? { kind, target: w.target, node: n.id } : null;
    }
    case "renameDeclaration": {
      const decls = scripts.flatMap((path) =>
        [...(state.model.file(path)?.declarations.keys() ?? [])].map(
          (name) => ({ path, name }),
        ),
      );
      const d = pick(decls, c.a);
      return d ? { kind, ...d, newName: c.name } : null;
    }
    case "replaceFileText": {
      const path = pick(paths, c.a);
      if (!path) return null;
      const file = state.model.file(path)?.source as SourceFile;
      const text = file.text;
      const at = c.a % (text.length + 1);
      const variant = c.snippet % 4;
      let next: string;
      if (variant === 0)
        next =
          text.slice(0, at) +
          text.slice(Math.min(text.length, at + (c.b % 40)));
      else if (variant === 1)
        next =
          text.slice(0, at) +
          (SNIPPETS[c.b % SNIPPETS.length] as string) +
          text.slice(at);
      else if (
        variant === 2 &&
        file.language === "nextflow" &&
        file.status === "modelled" &&
        file.ast
      )
        next = state.parser.printer.printScript(file.ast, {
          layout: state.parser.printer.createLayout(text),
        }).text;
      else next = `${text}\n// note\n`;
      return { kind, path, text: next };
    }
    case "setConfigOption":
    case "removeConfigOption":
    case "addConfigBlock":
    case "addConfigPlugin":
    case "removeConfigPlugin": {
      const configs = paths.filter(
        (p) => state.model.file(p)?.source.language === "config",
      );
      const path = pick(configs, c.a);
      if (!path) return null;
      const context: ConfigContext = {
        profile: c.b % 5 === 0 ? (pick(CONFIG_PROFILES, c.a) ?? null) : null,
        selector: null,
      };
      const chosen = pick(CONFIG_OPTIONS, c.b);
      if (!chosen) return null;
      const [option, value] = chosen;
      if (kind === "setConfigOption")
        return { kind, path, context, option, value };
      if (kind === "removeConfigOption") {
        // an option the file sets at its top level, when it has one
        const file = state.model.file(path)?.source;
        const present =
          file?.language === "config" && file.ast
            ? configOptionNames(file.ast)
            : [];
        return {
          kind,
          path,
          context:
            present.length > 0 ? { profile: null, selector: null } : context,
          option: pick(present, c.b) ?? option,
        };
      }
      if (kind === "addConfigBlock")
        return { kind, path, context, scope: [option[0] as string] };
      if (kind === "removeConfigPlugin") {
        // a plugin the file has, when it has one
        const file = state.model.file(path)?.source;
        const present =
          file?.language === "config" && file.ast
            ? plugins(file.ast).flatMap(({ node }) =>
                node.args[0]?.kind === "String" ? [node.args[0].value] : [],
              )
            : [];
        const id = pick(present, c.a) ?? pick(CONFIG_PLUGINS, c.a + c.b);
        return id ? { kind, path, id } : null;
      }
      const id = pick(CONFIG_PLUGINS, c.a + c.b);
      return id ? { kind, path, id } : null;
    }
    case "createFile": {
      const ext = [".nf", ".config", ".md", "/.gitkeep"][c.snippet % 4];
      return { kind, path: `${c.name.toLowerCase()}${ext}` };
    }
    default:
      return null;
  }
}

const mixedStyle = (file: SourceFile | undefined): boolean => {
  if (file?.ast?.kind !== "Script") return false;
  const styles = definitionStyles(file.ast);
  return (
    (styles.typed.length > 0 && styles.legacy.length > 0) ||
    styles.tagged.length > 0 ||
    file.problems.some((p) => p.code === MIXED_DEFINITIONS)
  );
};

const overlaps = (r: { start: number; end: number }, e: TextEdit): boolean =>
  e.start === e.end
    ? r.start < e.start && e.start < r.end
    : r.start < e.end && e.start < r.end;

const shifter = (edits: readonly TextEdit[]) => (offset: number) =>
  edits.reduce(
    (at, e) => (e.end <= offset ? at + e.text.length - (e.end - e.start) : at),
    offset,
  );

const workflowDef = (
  file: SourceFile | undefined,
  name: string | null,
): WorkflowDef | undefined =>
  file?.ast?.kind === "Script"
    ? file.ast.body.find(
        (i): i is WorkflowDef =>
          i.kind === "Workflow" && (i.name?.name ?? null) === name,
      )
    : undefined;

/** AR-22: what an edit to one file leaves alone. */
function checkUntouched(
  before: SourceFile,
  after: SourceFile,
  edits: readonly TextEdit[],
  label: string,
) {
  const shift = shifter(edits);
  if (before.ast?.kind === "Script")
    for (const item of before.ast.body) {
      if (edits.some((e) => overlaps(itemSpan(item), e))) continue;
      const start = shift(item.range.start);
      const found =
        after.ast?.kind === "Script"
          ? after.ast.body.find((i) => i.range.start === start)
          : undefined;
      expect(
        found,
        `${label}: item ${item.kind} at ${item.range.start} survives`,
      ).toBeDefined();
      expect(
        diffNodes(item, found),
        `${label}: item ${item.kind} at ${item.range.start} is equivalent`,
      ).toBeNull();
    }
  for (const comment of before.comments) {
    if (edits.some((e) => overlaps(comment.range, e))) continue;
    const start = shift(comment.range.start);
    expect(
      after.comments.some(
        (c) => c.range.start === start && c.text === comment.text,
      ),
      `${label}: comment ${JSON.stringify(comment.text)} survives`,
    ).toBe(true);
  }
}

function checkAccepted(
  state: EditState,
  command: EditCommand,
  patches: readonly TextPatch[],
  files: readonly { path: string; text: string | null }[],
) {
  const label = command.kind;
  const parsed = new Map<string, SourceFile>();
  for (const f of files) {
    if (f.text === null) continue;
    const before = state.model.file(f.path)?.source;
    const after = createSourceFile(f.path, f.text, state.parser);
    parsed.set(f.path, after);
    // (a2) a modelled file stays modelled, and a new file is modelled
    if ((!before && after.status !== "plain") || before?.status === "modelled")
      expect(after.status, `${label}: ${f.path} is still modelled`).toBe(
        "modelled",
      );
    // (a) AR-24: no problem the file didn't have; new files are clean
    const have = new Map<string, number>();
    for (const k of before ? problemKeys(before) : [])
      have.set(k, (have.get(k) ?? 0) + 1);
    for (const k of problemKeys(after)) {
      const n = have.get(k) ?? 0;
      expect(n, `${label}: new problem in ${f.path}: ${k}`).toBeGreaterThan(0);
      have.set(k, n - 1);
    }
    // (c) LA-13
    if (after.language === "nextflow" && mixedStyle(after))
      expect(mixedStyle(before), `${label}: ${f.path} became mixed`).toBe(true);
  }
  // (b) AR-22 protects what a command doesn't target. ReplaceFileText targets the whole file (plan 4.1(b)), so for it
  // the check is that every other file is untouched (asserted in the switch below: it patches only its own path).
  for (const patch of patches) {
    if (patch.kind !== "edit") continue;
    if (command.kind === "replaceFileText" && patch.path === command.path)
      continue;
    const before = state.model.file(patch.path)?.source as SourceFile;
    const after = parsed.get(patch.path) as SourceFile;
    checkUntouched(before, after, patch.edits, `${label} ${patch.path}`);
  }
  switch (command.kind) {
    case "addCall":
    case "connect":
    case "disconnect":
    case "deleteNode": {
      expect(patches.map((p) => p.path)).toEqual([command.target.path]);
      const before = state.model.file(command.target.path)?.source;
      const def = workflowDef(before, command.target.workflow);
      const patch = patches[0];
      if (!def || patch?.kind !== "edit") throw new Error("no target workflow");
      const span = itemSpan(def);
      for (const e of patch.edits) {
        expect(
          e.start,
          `${label}: edit inside the workflow`,
        ).toBeGreaterThanOrEqual(span.start);
        expect(e.end).toBeLessThanOrEqual(span.end);
      }
      // (d) AddCall keeps the other statements
      if (command.kind === "addCall") {
        const after = workflowDef(
          parsed.get(command.target.path),
          command.target.workflow,
        );
        const old = def.main?.items ?? [];
        const now = after?.main?.items ?? [];
        expect(now.length, "addCall adds one statement").toBe(old.length + 1);
        expect(structure(now.slice(0, old.length))).toEqual(structure(old));
      }
      break;
    }
    case "createProcess": {
      const patch = patches.find((p) => p.path === command.caller);
      const before = state.model.file(command.caller)
        ?.source as ScriptSourceFile;
      const boundaries = new Set<number>([0, before.text.length]);
      for (const item of before.ast?.body ?? []) {
        boundaries.add(itemSpan(item).start);
        boundaries.add(itemSpan(item).end);
      }
      if (patch?.kind !== "edit") throw new Error("no caller edit");
      for (const e of patch.edits) {
        expect(e.start).toBe(e.end);
        expect(boundaries.has(e.start), "include at an item boundary").toBe(
          true,
        );
      }
      break;
    }
    case "renameDeclaration":
      for (const patch of patches) {
        if (patch.kind !== "edit") throw new Error("rename edits only");
        const text = state.model.file(patch.path)?.source.text as string;
        for (const e of patch.edits) {
          expect(text.slice(e.start, e.end)).toBe(command.name);
          expect(e.text).toBe(command.newName);
        }
      }
      break;
    case "replaceFileText":
      expect(patches.map((p) => p.path)).toEqual(
        patches.length === 0 ? [] : [command.path],
      );
      break;
    case "createFile":
      expect(patches).toEqual([
        { kind: "create", path: command.path, text: "" },
      ]);
      break;
  }
}

/** Puts the model back to `base`, so runs stay independent. */
export function reset(state: EditState, base: ReadonlyMap<string, string>) {
  for (const p of state.model.paths())
    if (!base.has(p)) state.model.deleteFile(p);
  for (const [p, text] of base)
    if (state.model.file(p)?.source.text !== text) state.model.setFile(p, text);
}

/** One random sequence; throws (through `expect`) on a violated invariant. Leaves the model changed: call `reset`. */
export function runSequence(
  state: EditState,
  choices: readonly Choice[],
  stats: Stats,
) {
  const base = snapshot(state);
  const history: (readonly TextPatch[])[] = [];
  for (const choice of choices) {
    const command = buildCommand(state, choice);
    if (!command) {
      stats.skipped += 1;
      continue;
    }
    const before = snapshot(state);
    const result = applyCommand(state, command);
    if (!result.ok) {
      // (a) AR-24: refused means a message and no change
      expect(
        result.message.length,
        `${command.kind} refusal has a message`,
      ).toBeGreaterThan(0);
      expect(snapshot(state)).toEqual(before);
      stats.count(stats.refused, `${command.kind}:${result.code}`);
      // a refusal of a command's own making is a bug: only a comment the reprint would lose is an expected `internal`
      if (result.code === "internal")
        expect(
          result.message,
          `${command.kind} refused as internal: ${result.message}`,
        ).toMatch(/drop the comment/);
      if (result.code === "does-not-parse") {
        // a config command refuses a file that was already broken, saying so; it never produces a result that doesn't parse
        if (command.kind === "replaceFileText") continue;
        expect(
          result.message,
          `${command.kind} produced a result that doesn't parse: ${result.message}`,
        ).toMatch(/can't work around/);
        expect(command.kind).toMatch(/Config/);
      }
      continue;
    }
    checkAccepted(state, command, result.patches, result.files);
    stats.count(stats.accepted, command.kind);
    commit(state, result);
    history.push(result.inverse);
  }
  // AR-23: the inverses, newest first, restore the exact bytes and paths
  let current = snapshot(state);
  for (const inverse of history.reverse())
    current = applyPatches(current, inverse).files;
  expect(Object.fromEntries(current)).toEqual(Object.fromEntries(base));
}

/** Runs `numRuns` random sequences from `arb` (seed 111) against `state`, which is back at its start after each. */
export function assertSequences(
  state: EditState,
  arb: fc.Arbitrary<readonly Choice[]>,
  stats: Stats,
  numRuns: number,
) {
  const base = snapshot(state);
  // every kind is tried first, however the random kinds fall (small run counts can miss one)
  runFixedExamples(state, stats);
  fc.assert(
    fc.property(arb, (choices) => {
      try {
        runSequence(state, choices, stats);
      } finally {
        reset(state, base);
      }
    }),
    { seed: 111, numRuns },
  );
}

/** What has to happen first for a kind to have something to act on: a plugin is removed after one is added. */
const PRELUDE: Partial<Record<string, string>> = {
  removeConfigPlugin: "addConfigPlugin",
};

/**
 * The one mechanism for fixed examples, run first by `assertSequences`. One accepted command of every kind, by searching small choices for the first the state accepts, each run through
 * `runSequence` for its invariants. Random sequences alone leave a kind unexercised on some trees; this keeps the
 * "every kind is accepted" checks honest as kinds are added (F-601). A kind with no accepted choice stays at zero.
 */
function runFixedExamples(state: EditState, stats: Stats) {
  const base = snapshot(state);
  EDIT_COMMAND_KINDS.forEach((kind, index) => {
    const before = EDIT_COMMAND_KINDS.indexOf(
      PRELUDE[kind] as (typeof EDIT_COMMAND_KINDS)[number],
    );
    for (let i = 0; i < 40; i++) {
      const choice: Choice = {
        kind: index,
        a: i * 7,
        b: i * 13,
        name: `FIX${i}`,
        snippet: i,
      };
      const sequence =
        before >= 0 ? [{ ...choice, kind: before }, choice] : [choice];
      // search on a scratch tally; a sequence that accepted the kind is run again for the real one
      const scratch = new Stats();
      try {
        runSequence(state, sequence, scratch);
      } finally {
        reset(state, base);
      }
      if ((scratch.accepted.get(kind) ?? 0) === 0) continue;
      try {
        runSequence(state, sequence, stats);
      } finally {
        reset(state, base);
      }
      return;
    }
  });
}
