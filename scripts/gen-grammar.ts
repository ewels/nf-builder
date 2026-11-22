// pnpm gen:grammar <version> [--check] (F-006, ADR 0005): regenerates a language pack's lexers and parsers from its
// vendored nf-lang grammars. The grammars are never edited: the generator applies the pack's hand port
// (<pack>/grammar/port.ts) to a copy, runs antlr-ng on the copy and writes <pack>/src/generated/. Version-agnostic:
// the pack is found by version, and nothing here names a Nextflow version.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMain, packFor, REPO_ROOT } from "./check-common.ts";

export type GenOptions = { version: string; repoRoot?: string };

type PortEntry = { java: string; ts: string; occurrences: number };
type GrammarPort = {
  header: PortEntry;
  members: PortEntry;
  actions: readonly PortEntry[];
};
type Upstream = {
  nextflow: { version: string; tag: string; commit: string };
  grammar: { path: string; files: Record<string, string> };
};

const GRAMMARS = [
  "ScriptLexer",
  "ScriptParser",
  "ConfigLexer",
  "ConfigParser",
] as const;
const LEFTOVER_JAVA: readonly RegExp[] = [
  /_input\b/,
  /\(char\)/,
  /Character\./,
  /getText\(\)/,
  /import java/,
  /package nextflow\//,
];

/** "26.10" -> <repo>/packages/lang-2610. A version without a pack that has grammar/ lists the packs there are. */
export function packDir(version: string, repoRoot: string = REPO_ROOT): string {
  return packFor(version, "grammar/port.ts", "grammar/ directory", repoRoot);
}

export function readUpstream(pack: string): Upstream {
  const file = join(pack, "upstream.json");
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const json = JSON.parse(readFileSync(file, "utf8")) as Partial<Upstream>;
  const fail = (what: string): never => {
    throw new Error(`${file}: ${what}`);
  };
  const nf = json.nextflow;
  if (!nf?.tag || !nf.commit) fail('"nextflow" needs "tag" and "commit"');
  const grammar = json.grammar;
  if (!grammar?.path || !grammar.files)
    fail('"grammar" needs "path" and "files"');
  for (const name of GRAMMARS) {
    if (!grammar?.files?.[`${name}.g4`])
      fail(`"grammar.files" has no SHA-256 for ${name}.g4`);
  }
  return json as Upstream;
}

type Block = { text: string; line: number };

/** The braced action and member blocks of a grammar, skipping comments, literals, character sets and `options`. */
function scanBlocks(grammar: string): Block[] {
  const blocks: Block[] = [];
  const n = grammar.length;
  const skipQuoted = (from: number, quote: string): number => {
    let i = from + 1;
    while (i < n && grammar[i] !== quote) i += grammar[i] === "\\" ? 2 : 1;
    return i + 1;
  };
  const skipComment = (from: number): number | undefined => {
    if (grammar.startsWith("//", from)) {
      const end = grammar.indexOf("\n", from);
      return end === -1 ? n : end;
    }
    if (grammar.startsWith("/*", from)) {
      const end = grammar.indexOf("*/", from + 2);
      return end === -1 ? n : end + 2;
    }
    return undefined;
  };
  const skipBraced = (from: number): number => {
    let depth = 0;
    let i = from;
    while (i < n) {
      const comment = skipComment(i);
      if (comment !== undefined) i = comment;
      else if (grammar[i] === '"' || grammar[i] === "'")
        i = skipQuoted(i, grammar[i] as string);
      else {
        if (grammar[i] === "{") depth++;
        else if (grammar[i] === "}" && --depth === 0) return i + 1;
        i++;
      }
    }
    return n;
  };
  let i = 0;
  while (i < n) {
    const comment = skipComment(i);
    if (comment !== undefined) i = comment;
    else if (grammar[i] === "'") i = skipQuoted(i, "'");
    else if (grammar[i] === "[") {
      i++;
      while (i < n && grammar[i] !== "]") i += grammar[i] === "\\" ? 2 : 1;
      i++;
    } else if (grammar[i] === "{") {
      let end = skipBraced(i);
      if (grammar[end] === "?") end++;
      const before = grammar.slice(0, i).trimEnd();
      if (!/\boptions$/.test(before)) {
        // The block starts at "@name {" for header and members, so a port entry's text can contain it whole.
        blocks.push({
          text: grammar.slice(i, end),
          line: grammar.slice(0, i).split("\n").length,
        });
      }
      i = end;
    } else i++;
  }
  return blocks;
}

const blankComments = (grammar: string): string =>
  grammar.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) =>
    c.replace(/[^\n]/g, " "),
  );

const firstLine = (text: string): string =>
  (text.split("\n")[0] ?? "").slice(0, 80);

/**
 * Replaces every upstream Java snippet in `grammar` with its TypeScript port. Throws when an entry's `java` text does not
 * occur exactly `occurrences` times, and when any Java action is left without an entry.
 */
export function applyPort(
  grammar: string,
  port: GrammarPort,
  file: string,
): string {
  let text = grammar;
  const entries = [port.header, port.members, ...port.actions];
  for (const entry of entries) {
    const found = text.split(entry.java).length - 1;
    if (found !== entry.occurrences) {
      throw new Error(
        `${file}: port entry not found or count changed: expected ${entry.occurrences}, found ${found}: ${firstLine(entry.java)}`,
      );
    }
    text = text.split(entry.java).join(entry.ts);
  }
  const known = entries.map((e) => e.ts);
  for (const block of scanBlocks(text)) {
    if (!known.some((ts) => ts.includes(block.text))) {
      throw new Error(
        `${file}:${block.line}: Java left in grammar: ${firstLine(block.text)}. Add a port entry for it to grammar/port.ts.`,
      );
    }
  }
  const lines = blankComments(text).split("\n");
  for (const [index, line] of lines.entries()) {
    const hit = LEFTOVER_JAVA.find((pattern) => pattern.test(line));
    if (hit) {
      throw new Error(
        `${file}:${index + 1}: Java left in grammar: ${line.trim().slice(0, 80)} (matches ${hit})`,
      );
    }
  }
  return text;
}

export function generatedHeader(i: {
  version: string;
  packRel: string;
  grammarFile: string;
  path: string;
  tag: string;
  commit: string;
  antlrNg: string;
  noCheck: boolean;
}): string {
  return (
    `// Generated by \`pnpm gen:grammar ${i.version}\` with antlr-ng ${i.antlrNg} from nextflow-io/nextflow ${i.tag} (${i.commit}) ${i.path}/${i.grammarFile}.\n` +
    `// Do not edit: change ${i.packRel}/grammar/ and regenerate. Licence: Apache-2.0 (see grammar/SOURCE.md).\n` +
    (i.noCheck ? "// @ts-nocheck\n" : "")
  );
}

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

function antlrNgRunner(): { runner: string; version: string } {
  const pkgFile = join(REPO_ROOT, "node_modules", "antlr-ng", "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  return {
    runner: join(pkgFile, "..", pkg.bin["antlr-ng"] as string),
    version: pkg.version,
  };
}

/** Renders the four generated files in memory: name -> content. */
async function render(
  o: GenOptions,
): Promise<{ pack: string; files: Map<string, string> }> {
  const pack = packDir(o.version, o.repoRoot);
  const upstream = readUpstream(pack);
  const portModule = (await import(
    pathToFileURL(join(pack, "grammar", "port.ts")).href
  )) as { PORT: Record<string, GrammarPort> };
  const work = mkdtempSync(join(tmpdir(), "gen-grammar-"));
  try {
    const input = join(work, "in");
    const output = join(work, "out");
    mkdirSync(input);
    mkdirSync(output);
    for (const name of GRAMMARS) {
      const bytes = readFileSync(join(pack, "grammar", `${name}.g4`));
      const want = upstream.grammar.files[`${name}.g4`];
      if (sha256(bytes) !== want) {
        throw new Error(
          `${name}.g4 does not match the SHA-256 in upstream.json (${want}). The vendored grammar is never edited: restore it, or update the pin together with grammar/port.ts.`,
        );
      }
      const port = portModule.PORT[name];
      if (!port) throw new Error(`grammar/port.ts has no entry for ${name}`);
      writeFileSync(
        join(input, `${name}.g4`),
        applyPort(bytes.toString("utf8"), port, `${name}.g4`),
      );
    }
    const { runner, version: antlrNg } = antlrNgRunner();
    const run = spawnSync(
      process.execPath,
      [
        runner,
        "-Dlanguage=TypeScript",
        "-l",
        "false",
        "-v",
        "false",
        "-o",
        output,
        ...GRAMMARS.map((n) => `${n}.g4`),
      ],
      { cwd: input, encoding: "utf8" },
    );
    if (run.status !== 0) {
      throw new Error(`antlr-ng failed:\n${run.stdout}${run.stderr}`);
    }
    const files = new Map<string, string>();
    for (const name of GRAMMARS) {
      const generated = readFileSync(
        join(output, `${name}.ts`),
        "utf8",
      ).replace(/\r\n/g, "\n");
      const header = generatedHeader({
        version: o.version,
        packRel: `packages/${basename(pack)}`,
        grammarFile: `${name}.g4`,
        path: upstream.grammar.path,
        tag: upstream.nextflow.tag,
        commit: upstream.nextflow.commit,
        antlrNg,
        // antlr-ng output type-checks under the pack's strict tsconfig, so no `// @ts-nocheck` (O9); the header supports it if that changes.
        noCheck: false,
      });
      files.set(`${name}.ts`, header + generated);
    }
    return { pack, files };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Writes <pack>/src/generated/ from a temp dir, replacing the old directory in one rename. */
export async function generate(o: GenOptions): Promise<{ written: string[] }> {
  const { pack, files } = await render(o);
  const target = join(pack, "src", "generated");
  const staging = `${target}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    for (const [name, content] of files)
      writeFileSync(join(staging, name), content);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { written: [...files.keys()] };
}

/** Generates to memory and compares the file list and bytes with <pack>/src/generated/. */
export async function checkGenerated(
  o: GenOptions,
): Promise<{ differences: string[] }> {
  const { pack, files } = await render(o);
  const target = join(pack, "src", "generated");
  const have = existsSync(target) ? readdirSync(target).sort() : [];
  const differences: string[] = [];
  for (const [name, content] of files) {
    if (!have.includes(name)) differences.push(`${name} is missing`);
    else if (readFileSync(join(target, name), "utf8") !== content)
      differences.push(`${name} differs from the generator output`);
  }
  for (const name of have)
    if (!files.has(name)) differences.push(`${name} is not generator output`);
  return { differences };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const check = args.includes("--check");
  const rest = args.filter((a) => a !== "--check");
  const version = rest[0];
  if (version === undefined || rest.length !== 1) {
    console.error(
      "usage: pnpm gen:grammar <version> [--check]   e.g. pnpm gen:grammar 26.10",
    );
    return 2;
  }
  try {
    if (check) {
      const { differences } = await checkGenerated({ version });
      if (differences.length === 0) {
        console.log(
          `gen:grammar ${version}: src/generated matches the generator output`,
        );
        return 0;
      }
      for (const d of differences)
        console.error(`gen:grammar ${version}: ${d}`);
      console.error(
        `Generated files are never hand-edited: run pnpm gen:grammar ${version} and commit the result.`,
      );
      return 1;
    }
    const { written } = await generate({ version });
    console.log(`gen:grammar ${version}: wrote ${written.join(", ")}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (isMain(import.meta)) process.exitCode = await main(process.argv.slice(2));
