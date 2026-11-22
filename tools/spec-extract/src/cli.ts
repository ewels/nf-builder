// pnpm gen:catalogue <version> [--check] [--jar <path>] (F-006, ADR 0005, ADR 0020): extracts a language pack's
// catalogue from the pinned Nextflow language server jar and writes <pack>/catalogue/{script,config}.json.
// Standalone: imports no workspace package (the types in packages/lang-core/src/catalogue.ts describe the output).

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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const JAVA_FILE = fileURLToPath(new URL("SpecExtract.java", import.meta.url));
const USAGE = "Usage: pnpm gen:catalogue <version> [--check] [--jar <path>]";

export type Pin = { tag: string; nfLang: string; url: string; sha256: string };
export type CatalogueSource = {
  generator: "tools/spec-extract";
  languageServer: string;
  nfLang: string;
  jarSha256: string;
};
export type Kind = "script" | "config";
type Json = Record<string, unknown>;
export type Extracted = { script: unknown; config: unknown };

const packsOf = (repoRoot: string): string[] => {
  const dir = join(repoRoot, "packages");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => existsSync(join(dir, name, "grammar", "port.ts")))
        .sort()
    : [];
};

/** "26.10" -> <repo>/packages/lang-2610. A version without a pack lists the packs there are. */
export function packDir(version: string, repoRoot: string = REPO_ROOT): string {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  const name = match ? `lang-${match[1]}${match[2]}` : undefined;
  const packs = packsOf(repoRoot);
  if (name === undefined || !packs.includes(name)) {
    const known = packs.map((p) => p.replace(/^lang-(\d+)(\d{2})$/, "$1.$2"));
    throw new Error(
      `No language pack for version "${version}". Packs: ${known.join(", ") || "none"}.`,
    );
  }
  return join(repoRoot, "packages", name);
}

export function readPin(pack: string): Pin {
  const file = join(pack, "upstream.json");
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    languageServer?: Partial<Pin>;
  };
  const pin = json.languageServer;
  if (!pin?.tag || !pin.nfLang || !pin.url || !pin.sha256)
    throw new Error(
      `${file}: "languageServer" needs "tag", "nfLang", "url" and "sha256"`,
    );
  return { tag: pin.tag, nfLang: pin.nfLang, url: pin.url, sha256: pin.sha256 };
}

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function verifyJar(file: string, pin: Pin): void {
  const actual = sha256(file);
  if (actual !== pin.sha256)
    throw new Error(
      `${file} has SHA-256 ${actual}, but upstream.json pins ${pin.sha256} for language server ${pin.tag}. Delete the file to download it again, or update the pin.`,
    );
}

/** .cache/language-server/<tag>/language-server-all.jar, downloaded with curl (which honours the proxy) and verified. */
export function ensureJar(pin: Pin, cacheDir: string): string {
  const jar = join(cacheDir, pin.tag, "language-server-all.jar");
  if (existsSync(jar)) {
    verifyJar(jar, pin);
    return jar;
  }
  mkdirSync(dirname(jar), { recursive: true });
  const partial = `${jar}.part`;
  const result = spawnSync(
    "curl",
    ["-fsSL", "--retry", "3", "-o", partial, pin.url],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    rmSync(partial, { force: true });
    throw new Error(
      `could not download ${pin.url}: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  try {
    verifyJar(partial, pin);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  renameSync(partial, jar);
  return jar;
}

export function runExtractor(
  jar: string,
  outDir: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync("java", ["-cp", jar, JAVA_FILE, outDir], {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    const missing = (result.error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing
        ? "java not found: install a JDK 17+ (java on PATH)"
        : `could not run java: ${result.error.message}`,
    );
  }
  if (result.status !== 0)
    throw new Error(
      `SpecExtract.java failed (exit ${result.status}):\n${result.stderr.trim()}`,
    );
}

// ---- normalisation -----------------------------------------------------------------------------------------

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Trims, and removes the indentation of the text block the description was written in. */
function tidy(text: unknown): string {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const indents = lines
    .filter((l) => l.trim() !== "")
    .map((l) => /^ */.exec(l)?.[0].length ?? 0);
  const strip = indents.length > 0 ? Math.min(...indents) : 0;
  return lines
    .map((l) => l.slice(strip).trimEnd())
    .join("\n")
    .trim();
}

function signature(raw: Json): Json {
  const params = (raw.parameters as Json[]).map((p) => ({
    name: p.name,
    type: p.type,
  }));
  return {
    parameters: params,
    returns: raw.returns,
    varargs: raw.varargs === true,
    deprecated: raw.deprecated === true,
  };
}

function entry(raw: Json): Json {
  const signatures = (raw.signatures as Json[]).map(signature).sort((a, b) => {
    const key = (s: Json): string =>
      `${(s.parameters as unknown[]).length}|${JSON.stringify(s.parameters)}|${s.returns}`;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  const out: Json = {
    name: raw.name,
    description: tidy(raw.description),
    deprecated: signatures.length > 0 && signatures.every((s) => s.deprecated),
    signatures,
  };
  if (raw.receiver !== undefined) out.receiver = raw.receiver;
  return out;
}

const entries = (raw: unknown): Json[] =>
  (raw as Json[]).map(entry).sort(byName as (a: Json, b: Json) => number);

const group = (raw: Json): Json => ({
  name: raw.name,
  description: tidy(raw.description),
  members: entries(raw.members),
});

function configNode(raw: Json): Json {
  const base = {
    kind: raw.kind,
    name: raw.name,
    description: tidy(raw.description),
  };
  const children = (): Json[] =>
    (raw.children as Json[])
      .map(configNode)
      .sort(byName as (a: Json, b: Json) => number);
  switch (raw.kind) {
    case "scope":
      return { ...base, children: children() };
    case "option":
      return { ...base, types: [...(raw.types as string[])].sort() };
    case "placeholder":
      return {
        ...base,
        placeholderName: raw.placeholderName,
        children: children(),
      };
    case "dsl":
      return { ...base, dsl: raw.dsl };
    default:
      throw new Error(`unknown config node kind ${String(raw.kind)}`);
  }
}

/** Sorts by name at every level, tidies descriptions and puts signatures in a stable order. */
export function normalise(
  raw: unknown,
  source: CatalogueSource,
  kind: Kind,
): Json {
  if (kind === "config")
    return {
      source,
      scopes: (raw as Json[])
        .map(configNode)
        .sort(byName as (a: Json, b: Json) => number),
    };
  const r = raw as Json;
  const sections = r.processSections as Json;
  const operators = entries(r.operators).sort((a, b) => {
    const key = (o: Json): string => `${o.receiver}.${o.name}`;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  return {
    source,
    directives: entries(r.directives),
    processSections: {
      inputs: entries(sections.inputs),
      outputs: entries(sections.outputs),
      typedOutputs: entries(sections.typedOutputs),
      stage: entries(sections.stage),
    },
    agentDirectives: entries(r.agentDirectives),
    operators,
    factories: entries(r.factories),
    constants: entries(r.constants),
    functions: entries(r.functions),
    namespaces: (r.namespaces as Json[])
      .map(group)
      .sort(byName as (a: Json, b: Json) => number),
    types: (r.types as Json[])
      .map(group)
      .sort(byName as (a: Json, b: Json) => number),
    featureFlags: (r.featureFlags as Json[])
      .map((f) => ({
        name: f.name,
        description: tidy(f.description),
        type: f.type,
        preview: f.preview === true,
      }))
      .sort(byName as (a: Json, b: Json) => number),
  };
}

export const serialise = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

// ---- command -----------------------------------------------------------------------------------------------

export type MainIo = {
  repoRoot?: string;
  /** Replaces the Java run, for tests. */
  extract?: (pin: Pin, jarSha256: string) => Extracted;
};

function defaultExtract(jar: string): Extracted {
  const work = mkdtempSync(join(tmpdir(), "spec-extract-"));
  try {
    runExtractor(jar, work);
    return {
      script: JSON.parse(readFileSync(join(work, "script.raw.json"), "utf8")),
      config: JSON.parse(readFileSync(join(work, "config.raw.json"), "utf8")),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Returns the exit code: 0 done, 1 the catalogue differs (--check) or extraction failed, 2 usage. */
export function main(argv: readonly string[], io: MainIo = {}): number {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const repoRoot = io.repoRoot ?? REPO_ROOT;
  let values: { check?: boolean; jar?: string };
  let positionals: string[];
  try {
    const result = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: { check: { type: "boolean" }, jar: { type: "string" } },
    });
    values = result.values;
    positionals = result.positionals;
  } catch (error) {
    console.error(`gen:catalogue: ${(error as Error).message}`);
    console.error(USAGE);
    return 2;
  }
  const [version] = positionals;
  if (positionals.length !== 1 || version === undefined) {
    console.error(USAGE);
    return 2;
  }
  try {
    const pack = packDir(version, repoRoot);
    const pin = readPin(pack);
    let extracted: Extracted;
    let jarSha256 = pin.sha256;
    if (io.extract) {
      extracted = io.extract(pin, jarSha256);
    } else {
      const jar = values.jar
        ? resolve(values.jar)
        : ensureJar(pin, join(repoRoot, ".cache", "language-server"));
      verifyJar(jar, pin);
      jarSha256 = sha256(jar);
      extracted = defaultExtract(jar);
    }
    const source: CatalogueSource = {
      generator: "tools/spec-extract",
      languageServer: pin.tag,
      nfLang: pin.nfLang,
      jarSha256,
    };
    const files: Record<string, string> = {
      "script.json": serialise(normalise(extracted.script, source, "script")),
      "config.json": serialise(normalise(extracted.config, source, "config")),
    };
    const dir = join(pack, "catalogue");
    if (values.check) {
      let differs = 0;
      for (const [name, text] of Object.entries(files)) {
        const file = join(dir, name);
        if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
          console.error(
            `catalogue/${name} differs from the generator output; never hand-edit it, run pnpm gen:catalogue ${version}`,
          );
          differs++;
        }
      }
      if (differs > 0) return 1;
      console.log(`catalogue: ${Object.keys(files).length} files up to date`);
      return 0;
    }
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(dir, name), text);
    console.log(`catalogue: wrote ${Object.keys(files).join(", ")}`);
    return 0;
  } catch (error) {
    console.error(`gen:catalogue: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.filename === process.argv[1])
  process.exitCode = main(process.argv.slice(2));
