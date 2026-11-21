import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";

const read = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8");

function markdownSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) throw new Error(`No "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function pnpmCommands(markdown: string): string[] {
  const commands: string[] = [];
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const text = match[1] ?? "";
    if (!text.startsWith("pnpm ")) continue;
    for (const part of text.split("&&")) commands.push(part.trim());
  }
  return commands;
}

type Resolved =
  | { kind: "builtin"; name: string }
  | { kind: "root"; script: string }
  | { kind: "filtered"; filter: string; script: string };

const BUILTINS = ["install", "add", "audit", "exec", "dlx"];

function resolvePnpm(command: string): Resolved {
  const tokens = command.split(/\s+/).slice(1);
  let filter: string | undefined;
  if (tokens[0] === "--filter" || tokens[0] === "-F") {
    filter = tokens[1];
    tokens.splice(0, 2);
  } else if (tokens[0]?.startsWith("--filter=")) {
    filter = tokens[0].slice("--filter=".length);
    tokens.shift();
  }
  if (tokens[0] === "run") tokens.shift();
  const name = tokens[0] ?? "";
  if (filter !== undefined) return { kind: "filtered", filter, script: name };
  if (BUILTINS.includes(name)) return { kind: "builtin", name };
  return { kind: "root", script: name };
}

type Pkg = { dir: string; name: string; scripts: Record<string, string> };

function workspacePackages(): Pkg[] {
  const packages: Pkg[] = [];
  for (const group of ["apps", "packages", "tools"]) {
    if (!existsSync(join(REPO_ROOT, group))) continue;
    for (const entry of readdirSync(join(REPO_ROOT, group))) {
      const file = join(group, entry, "package.json");
      if (!existsSync(join(REPO_ROOT, file))) continue;
      const json = JSON.parse(read(file)) as {
        name: string;
        scripts?: Record<string, string>;
      };
      packages.push({
        dir: `${group}/${entry}`,
        name: json.name,
        scripts: json.scripts ?? {},
      });
    }
  }
  return packages;
}

function scriptsRunByCheck(check: string): string[] {
  return [...check.matchAll(/pnpm run ([\w:.-]+)/g)].map((m) => m[1] ?? "");
}

const rootScripts = (): Record<string, string> =>
  (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
    .scripts;

function missingCommands(section: string): string[] {
  const missing: string[] = [];
  const root = rootScripts();
  const packages = workspacePackages();
  for (const command of pnpmCommands(section)) {
    const resolved = resolvePnpm(command);
    if (resolved.kind === "builtin") continue;
    if (resolved.kind === "root") {
      if (!(resolved.script in root))
        missing.push(
          `${command}: no "${resolved.script}" script in package.json`,
        );
      continue;
    }
    const targets = /^<[^>]+>$/.test(resolved.filter)
      ? packages
      : packages.filter(
          (p) =>
            p.name === resolved.filter ||
            p.name.endsWith(`/${resolved.filter}`),
        );
    if (targets.length === 0)
      missing.push(`${command}: no workspace package "${resolved.filter}"`);
    for (const p of targets)
      if (!(resolved.script in p.scripts))
        missing.push(`${command}: ${p.dir} has no "${resolved.script}" script`);
  }
  return missing;
}

describe("AGENTS.md Commands section", () => {
  it("F-004 step 3: the Commands parser finds pnpm commands in code spans and resolves --filter, run and -- arguments", () => {
    const section = [
      "| `pnpm install` | x |",
      "| `pnpm build && pnpm check:budget` | x |",
      "| `pnpm --filter <package> test` | x |",
      "| `pnpm -F web build` | x |",
      "| `pnpm --filter=web dev` | x |",
      "| `pnpm run format` | x |",
      "| `pnpm test:e2e -- --grep F-123` | x |",
      "| `corpus:fetch` | x |",
    ].join("\n");
    expect(pnpmCommands(section).map(resolvePnpm)).toEqual([
      { kind: "builtin", name: "install" },
      { kind: "root", script: "build" },
      { kind: "root", script: "check:budget" },
      { kind: "filtered", filter: "<package>", script: "test" },
      { kind: "filtered", filter: "web", script: "build" },
      { kind: "filtered", filter: "web", script: "dev" },
      { kind: "root", script: "format" },
      { kind: "root", script: "test:e2e" },
    ]);
  });

  it("F-004 step 3: every pnpm command in the AGENTS.md Commands section exists", () => {
    const missing = missingCommands(
      markdownSection(read("AGENTS.md"), "Commands"),
    );
    expect(
      missing,
      "AGENTS.md Commands lists commands that don't exist: add the script or remove the row",
    ).toEqual([]);
  });

  it("F-004 step 3: every root package.json script is in the AGENTS.md Commands section or run by pnpm check", () => {
    const root = rootScripts();
    const documented = pnpmCommands(
      markdownSection(read("AGENTS.md"), "Commands"),
    )
      .map(resolvePnpm)
      .flatMap((r) => (r.kind === "root" ? [r.script] : []));
    const run = scriptsRunByCheck(root.check ?? "");
    const undocumented = Object.keys(root).filter(
      (s) => s !== "check" && !documented.includes(s) && !run.includes(s),
    );
    expect(
      undocumented,
      `root scripts missing from the AGENTS.md Commands table (add a row for each): ${undocumented.join(", ")}`,
    ).toEqual([]);
  });
});

describe("pull request template", () => {
  it("F-004: the PR template's Definition of done mirrors AGENTS.md item for item", () => {
    const agents = markdownSection(read("AGENTS.md"), "Definition of done")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).replace(/\.$/, ""));
    const template = markdownSection(
      read(".github/pull_request_template.md"),
      "Definition of done",
    )
      .split("\n")
      .filter((l) => l.startsWith("- [ ] "))
      .map((l) => l.slice("- [ ] ".length));
    expect(template.length).toBe(agents.length);
    agents.forEach((item, i) => {
      const got = template[i] ?? "";
      expect(
        got === item ||
          new RegExp(
            `^${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ :,]`,
          ).test(got),
        `template item ${i + 1} "${got}" should start with "${item}"`,
      ).toBe(true);
    });
  });
});
