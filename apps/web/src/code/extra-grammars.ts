// The 13 Shiki grammars for the non-Nextflow languages (F-605, FI-32): one lazy chunk, about 34 kB gzipped, loaded by the
// first file that needs one. HTML, CSS, XML and Perl are left out because they embed other languages.
import type { LanguageRegistration } from "shiki/core";
import csv from "shiki/langs/csv.mjs";
import diff from "shiki/langs/diff.mjs";
import groovy from "shiki/langs/groovy.mjs";
import ini from "shiki/langs/ini.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import mermaid from "shiki/langs/mermaid.mjs";
import python from "shiki/langs/python.mjs";
import r from "shiki/langs/r.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import toml from "shiki/langs/toml.mjs";
import tsv from "shiki/langs/tsv.mjs";
import yaml from "shiki/langs/yaml.mjs";
import type { EditorLanguage } from "../files/file-kinds";

export const EXTRA_GRAMMARS: readonly {
  readonly id: EditorLanguage;
  readonly grammar: LanguageRegistration[];
}[] = [
  { id: "markdown", grammar: markdown },
  { id: "yaml", grammar: yaml },
  { id: "json", grammar: json },
  { id: "shellscript", grammar: shellscript },
  { id: "python", grammar: python },
  { id: "r", grammar: r },
  { id: "groovy", grammar: groovy },
  { id: "toml", grammar: toml },
  { id: "ini", grammar: ini },
  { id: "csv", grammar: csv },
  { id: "tsv", grammar: tsv },
  { id: "diff", grammar: diff },
  { id: "mermaid", grammar: mermaid },
];
