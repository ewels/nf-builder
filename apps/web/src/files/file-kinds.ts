// What kind of editor a project file gets (F-605, FI-30, FI-32, UX-52). Pure and eager: no Monaco, no Shiki.
import { languageOf, type WorkflowRef } from "@nf-builder/engine";

export type EditorLanguage =
  | "nextflow"
  | "markdown"
  | "yaml"
  | "json"
  | "shellscript"
  | "python"
  | "r"
  | "groovy"
  | "toml"
  | "ini"
  | "csv"
  | "tsv"
  | "diff"
  | "mermaid"
  | "plaintext";

export const LANGUAGE_NAMES: Record<EditorLanguage, string> = {
  nextflow: "Nextflow",
  markdown: "Markdown",
  yaml: "YAML",
  json: "JSON",
  shellscript: "Shell script",
  python: "Python",
  r: "R",
  groovy: "Groovy",
  toml: "TOML",
  ini: "INI",
  csv: "CSV",
  tsv: "TSV",
  diff: "Diff",
  mermaid: "Mermaid",
  plaintext: "Plain text",
};

// matched without case; the longer endings come first so `.nf.test` is Groovy and `.nf` is Nextflow
const EXTENSIONS: readonly (readonly [string, EditorLanguage])[] = [
  [".nf.test.snap", "json"],
  [".nf.test", "groovy"],
  [".nf", "nextflow"],
  [".config", "nextflow"],
  [".groovy", "groovy"],
  [".json", "json"],
  [".snap", "json"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".cff", "yaml"],
  [".markdown", "markdown"],
  [".md", "markdown"],
  [".sh", "shellscript"],
  [".bash", "shellscript"],
  [".py", "python"],
  [".r", "r"],
  [".toml", "toml"],
  [".ini", "ini"],
  [".cfg", "ini"],
  [".csv", "csv"],
  [".tsv", "tsv"],
  [".diff", "diff"],
  [".patch", "diff"],
  [".mmd", "mermaid"],
];

/** The Monaco language of a file, from its name; anything unknown is plain text (FI-32). */
export function editorLanguageOf(path: string): EditorLanguage {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "nf-test.config") return "groovy";
  for (const [ending, language] of EXTENSIONS) {
    if (name.endsWith(ending)) return language;
  }
  return "plaintext";
}

type FileEditor = "markdown" | "code";

/** Markdown exactly when the engine's AR-01 rule says so, so `README.MD` opens as code. */
export function fileEditorOf(path: string): FileEditor {
  return languageOf(path) === "markdown" ? "markdown" : "code";
}

type OpenTarget =
  | { readonly kind: "workflow"; readonly ref: WorkflowRef }
  | { readonly kind: "file" };

/** A file with workflows opens its entry workflow, else its first (UX-52); any other file opens in a file tab. */
export function openTargetOf(
  path: string,
  workflows: readonly WorkflowRef[],
): OpenTarget {
  const inFile = workflows.filter((w) => w.path === path);
  const ref = inFile.find((w) => w.name === null) ?? inFile[0];
  return ref === undefined ? { kind: "file" } : { kind: "workflow", ref };
}
