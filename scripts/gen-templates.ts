// pnpm gen:templates <version> [--check] (F-203, ADR 0006): bundles a language pack's template trees
// (packages/lang-*/templates/<id>/**, listed in templates/templates.yaml) into the committed templates.json that
// the pack loads lazily. A template is a real project tree, text only (IO-01, IO-12), and the oracle runs it in
// place (cases template-<id>), so the bytes in templates.json are the bytes the oracle checked.

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { isMain, packFor, REPO_ROOT } from "./check-common.ts";

export interface TemplateFile {
  readonly path: string;
  readonly text: string;
}
interface Meta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

const MAX_FILE_BYTES = 1024 * 1024;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "26.10" -> packages/lang-2610/templates/{<id>/,templates.yaml} and templates.json. */
export function templatePaths(
  version: string,
  repoRoot: string = REPO_ROOT,
): { dir: string; yaml: string; json: string } {
  const pack = packFor(
    version,
    "templates/templates.yaml",
    "templates/templates.yaml",
    repoRoot,
  );
  const dir = join(pack, "templates");
  return {
    dir,
    yaml: join(dir, "templates.yaml"),
    json: join(pack, "templates.json"),
  };
}

/** Every file under dir, sorted by path, as UTF-8 text. Throws on binary, non-UTF-8, CRLF, symlinks, dotfiles and files over 1 MB. */
export function readTemplateTree(dir: string): TemplateFile[] {
  const files: TemplateFile[] = [];
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(dir, relative)).sort()) {
      const path = relative === "" ? name : `${relative}/${name}`;
      const full = join(dir, path);
      if (name.startsWith(".")) throw new Error(`${path}: dotfile`);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`${path}: symlink`);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) throw new Error(`${path}: over 1 MB`);
      const bytes = readFileSync(full);
      if (bytes.includes(0)) throw new Error(`${path}: binary file`);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`${path}: not valid UTF-8`);
      }
      if (text.includes("\r")) throw new Error(`${path}: CRLF line ending`);
      files.push({ path, text });
    }
  };
  walk("");
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const isMeta = (value: unknown, where: string, file: string): Meta => {
  const v = value as Record<string, unknown> | null;
  if (typeof v !== "object" || v === null) {
    throw new Error(`${file}: ${where} must be a mapping`);
  }
  for (const key of ["id", "name", "description"]) {
    if (typeof v[key] !== "string" || v[key] === "") {
      throw new Error(`${file}: ${where}.${key} must be a non-empty string`);
    }
  }
  return {
    id: v.id as string,
    name: v.name as string,
    description: v.description as string,
  };
};

/** The bundle as two-space JSON with a trailing newline: blank first, then the templates in YAML order. */
export function templatesJson(
  yamlText: string,
  file: string,
  read: (id: string) => TemplateFile[],
): string {
  const doc = parseDocument(yamlText, { schema: "core" });
  const [error] = doc.errors;
  if (error !== undefined) {
    const line = error.linePos?.[0].line ?? 1;
    throw new Error(`${file}:${line}: ${error.message.split("\n")[0]}`);
  }
  const root = doc.toJS() as { blank?: unknown; templates?: unknown };
  if (!Array.isArray(root.templates)) {
    throw new Error(`${file}: templates must be a list`);
  }
  const blank = isMeta(root.blank, "blank", file);
  const templates = root.templates.map((t, i) =>
    isMeta(t, `templates[${i}]`, file),
  );
  const seen = new Set<string>();
  for (const { id } of [blank, ...templates]) {
    if (!KEBAB.test(id))
      throw new Error(`${file}: id "${id}" must be kebab-case`);
    if (seen.has(id)) throw new Error(`${file}: duplicate id "${id}"`);
    seen.add(id);
  }
  const bundle = (meta: Meta) => ({ ...meta, files: read(meta.id) });
  return `${JSON.stringify({ blank: bundle(blank), templates: templates.map(bundle) }, null, 2)}\n`;
}

export function genTemplates(opts: {
  version: string;
  check?: boolean;
  repoRoot?: string;
}): { status: 0 | 1; message: string } {
  const paths = templatePaths(opts.version, opts.repoRoot);
  const yamlText = readFileSync(paths.yaml, "utf8");
  const listed = new Set<string>();
  const json = templatesJson(yamlText, paths.yaml, (id) => {
    listed.add(id);
    const dir = join(paths.dir, id);
    if (!existsSync(dir)) {
      throw new Error(
        `${paths.yaml}: template "${id}" has no directory ${dir}`,
      );
    }
    try {
      return readTemplateTree(dir);
    } catch (error) {
      throw new Error(`${id}/${(error as Error).message}`);
    }
  });
  for (const entry of readdirSync(paths.dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !listed.has(entry.name)) {
      throw new Error(
        `${paths.dir}/${entry.name} is not listed in templates.yaml`,
      );
    }
  }
  if (opts.check) {
    const current = existsSync(paths.json)
      ? readFileSync(paths.json, "utf8")
      : undefined;
    return current === json
      ? {
          status: 0,
          message: `gen:templates ${opts.version}: templates.json matches the template trees`,
        }
      : {
          status: 1,
          message: `templates.json differs from the template trees; run pnpm gen:templates ${opts.version}, never hand-edit templates.json`,
        };
  }
  writeFileSync(paths.json, json);
  return {
    status: 0,
    message: `gen:templates ${opts.version}: wrote ${paths.json}`,
  };
}

/** Exit codes: 0 ok, 1 differs or invalid input, 2 usage. */
export function main(argv: readonly string[]): number {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const check = args.includes("--check");
  const rest = args.filter((a) => a !== "--check");
  const version = rest[0];
  if (version === undefined || rest.length !== 1) {
    console.error(
      "usage: pnpm gen:templates <version> [--check]   e.g. pnpm gen:templates 26.10",
    );
    return 2;
  }
  try {
    const { status, message } = genTemplates({ version, check });
    (status === 0 ? console.log : console.error)(message);
    return status;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isMain(import.meta)) process.exitCode = main(process.argv.slice(2));
