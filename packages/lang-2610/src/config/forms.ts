// The config editor's form layout and the mapping from catalogue types to value kinds (F-601, FI-02; plan 2.3 and 2.4).
import type { ConfigFormLayout, ConfigValueKind } from "@nf-builder/lang-core";

/** First-class forms and the fields each always shows, in order. Every name is a catalogue option (a unit test checks). */
export const CONFIG_FORMS: ConfigFormLayout = {
  scopes: [
    {
      scope: "manifest",
      form: "options",
      pinned: [
        "name",
        "description",
        "version",
        "nextflowVersion",
        "homePage",
        "license",
        "defaultBranch",
      ],
    },
    { scope: "params", form: "params", pinned: [] },
    {
      scope: "process",
      form: "process",
      pinned: [
        "cpus",
        "memory",
        "time",
        "container",
        "executor",
        "queue",
        "errorStrategy",
        "maxRetries",
        "resourceLimits",
      ],
    },
    { scope: "profiles", form: "profiles", pinned: [] },
    { scope: "plugins", form: "plugins", pinned: [] },
    {
      scope: "docker",
      form: "options",
      pinned: ["enabled", "runOptions", "registry"],
    },
    {
      scope: "singularity",
      form: "options",
      pinned: ["enabled", "autoMounts", "cacheDir", "runOptions"],
    },
    {
      scope: "apptainer",
      form: "options",
      pinned: ["enabled", "autoMounts", "cacheDir", "runOptions"],
    },
    {
      scope: "conda",
      form: "options",
      pinned: ["enabled", "channels", "useMamba", "cacheDir"],
    },
    {
      scope: "wave",
      form: "options",
      pinned: ["enabled", "strategy", "freeze"],
    },
    {
      scope: "executor",
      form: "options",
      pinned: [
        "name",
        "queueSize",
        "cpus",
        "memory",
        "pollInterval",
        "submitRateLimit",
      ],
    },
  ],
  maps: {
    "process.resourceLimits": {
      cpus: "integer",
      memory: "memory",
      disk: "memory",
      time: "duration",
    },
  },
};

const KINDS: Readonly<Record<string, ConfigValueKind>> = {
  String: "string",
  Boolean: "boolean",
  boolean: "boolean",
  Integer: "integer",
  Float: "decimal",
  Double: "decimal",
  float: "decimal",
  MemoryUnit: "memory",
  Duration: "duration",
  "List<String>": "stringList",
  "String[]": "stringList",
  "Set<String>": "stringList",
};

/** The widget for an option: a fixed-key map of the layout, else the first type that has a kind, else read-only code. */
export function valueKindOf(
  names: readonly string[],
  types: readonly string[],
): ConfigValueKind {
  if (names.join(".") in CONFIG_FORMS.maps) return "map";
  for (const type of types) {
    const kind = KINDS[type];
    if (kind !== undefined) return kind;
  }
  return "code";
}
