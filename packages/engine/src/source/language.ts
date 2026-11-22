import type { SourceLanguage } from "@nf-builder/lang-core";

/** The AR-01 language of a project file, by its name. The case of the extension counts (`.NF` is text). */
export function languageOf(path: string): SourceLanguage {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "nf-test.config") return "text"; // nf-test's own Groovy config, not a Nextflow config
  if (name.endsWith(".nf")) return "nextflow";
  if (name.endsWith(".config")) return "config";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "yaml";
  if (name.endsWith(".md")) return "markdown";
  return "text";
}
