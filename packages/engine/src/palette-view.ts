import type {
  Catalogue,
  PaletteDefinition,
  PaletteIcon,
  PaletteItem,
  PaletteView,
  PaletteViewItem,
  ScriptCatalogue,
} from "@nf-builder/lang-core";

const READ_MORE = /^\[Read more\]\([^)]*\)$/;

/** Markdown description to plain text: drops "Read more" paragraphs, reduces links to their text, removes backticks. */
export function plainText(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "" && !READ_MORE.test(p))
    .map((p) =>
      p
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replaceAll("`", "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("\n\n");
}

/** The first paragraph of plain text. */
export function firstParagraph(text: string): string {
  return text.split("\n\n")[0] ?? "";
}

export function operatorDescription(script: ScriptCatalogue, name: string) {
  const modern = script.operators.filter(
    (o) => o.name === name && !o.deprecated,
  );
  const entries = script.operators.filter((o) => o.name === name);
  return (
    modern.find((o) => o.receiver === "Channel") ??
    modern[0] ??
    entries[0]
  )?.description;
}

export function factoryDescription(script: ScriptCatalogue, name: string) {
  const entries = script.factories.filter((f) => f.name === name);
  return (entries.find((f) => !f.deprecated) ?? entries[0])?.description;
}

function resolveItem(
  version: string,
  item: PaletteItem,
  categoryIcon: PaletteIcon,
  catalogue: Catalogue,
): PaletteViewItem {
  let key: string;
  let label: string;
  let markdown: string | undefined;
  if (item.kind === "construct") {
    key = item.id;
    label = item.label;
    markdown = item.description;
  } else {
    key = `${item.kind}:${item.name}`;
    label = item.name;
    markdown =
      item.kind === "operator"
        ? operatorDescription(catalogue.script, item.name)
        : item.kind === "factory"
          ? factoryDescription(catalogue.script, item.name)
          : catalogue.config.scopes.find((n) => n.name === item.name)
              ?.description;
    if (markdown === undefined)
      throw new Error(
        `palette item ${key}: no ${item.kind} "${item.name}" in the ${version} catalogue`,
      );
  }
  const description = plainText(markdown);
  return {
    key,
    kind: item.kind,
    name: item.kind === "construct" ? item.id : item.name,
    label,
    summary: firstParagraph(description),
    description,
    keywords: item.keywords ?? [],
    icon: item.icon ?? categoryIcon,
    preview: item.preview === true,
    ...(item.docs === undefined ? {} : { docs: item.docs }),
  };
}

/** Resolves every palette item against the catalogue, in palette order. Throws for a name the catalogue lacks. */
export function resolvePaletteView(
  version: string,
  palette: PaletteDefinition,
  catalogue: Catalogue,
): PaletteView {
  const resolve = (item: PaletteItem, icon: PaletteIcon) =>
    resolveItem(version, item, icon, catalogue);
  return {
    version,
    categories: palette.categories.map((c) => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      items: (c.items ?? []).map((i) => resolve(i, c.icon)),
      groups: (c.groups ?? []).map((g) => ({
        id: g.id,
        label: g.label,
        items: g.items.map((i) => resolve(i, c.icon)),
      })),
    })),
  };
}
