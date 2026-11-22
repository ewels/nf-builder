import type { ConfigItem, ScriptItem } from "@nf-builder/lang-core";

/** The fixtures.yaml name of a top-level item: "process NAME", "workflow", "assign a.b", "block NAME", ... */
export function labelOf(item: ScriptItem | ConfigItem, text: string): string {
  const join = (...parts: (string | null | undefined)[]) =>
    parts.filter((p) => p).join(" ");
  switch (item.kind) {
    case "Unparsed":
      return join(item.head?.keyword, item.head?.name);
    case "Process":
    case "Agent":
    case "Record":
    case "Enum":
    case "Function":
      return join(
        item.kind === "Process"
          ? "process"
          : item.kind === "Agent"
            ? "agent"
            : item.kind === "Record"
              ? "record"
              : item.kind === "Enum"
                ? "enum"
                : "function",
        item.name.name,
      );
    case "Workflow":
      return join("workflow", item.name?.name);
    case "FeatureFlag":
      return join("featureFlag", item.name.name);
    case "Include":
      return "include";
    case "Import":
      return join("import", item.name);
    case "ParamsBlock":
      return "params";
    case "LegacyParam":
      return join(
        "param",
        text.slice(item.range.start, item.range.end).split("=")[0]?.trim(),
      );
    case "OutputBlock":
      return "output";
    case "ConfigAssign":
      return join("assign", item.path.map((n) => n.name).join("."));
    case "ConfigBlock":
    case "ConfigApplyBlock":
      return join("block", item.name.name);
    case "ConfigInclude":
      return "includeConfig";
    default:
      return item.kind === "ConfigSelector" ? "block" : "statement";
  }
}
