import type {
  PaletteView,
  PaletteViewCategory,
  PaletteViewItem,
} from "@nf-builder/lang-core";

/** Lower-cased, whitespace-separated terms; blank gives []. */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term is a substring of label, name, description or a keyword (case-insensitive). [] matches everything. */
export function paletteItemMatches(
  item: PaletteViewItem,
  terms: readonly string[],
): boolean {
  const fields = [
    item.label,
    item.name,
    item.description,
    ...item.keywords,
  ].map((f) => f.toLowerCase());
  return terms.every((t) => fields.some((f) => f.includes(t)));
}

/** Keeps matching items in order; drops groups and categories left empty. A blank query returns `view` itself. Category and group labels are not searched. */
export function searchPalette(view: PaletteView, query: string): PaletteView {
  const terms = queryTerms(query);
  if (terms.length === 0) return view;
  const keep = (items: readonly PaletteViewItem[]) =>
    items.filter((i) => paletteItemMatches(i, terms));
  const categories: PaletteViewCategory[] = [];
  for (const c of view.categories) {
    const items = keep(c.items);
    const groups = c.groups
      .map((g) => ({ ...g, items: keep(g.items) }))
      .filter((g) => g.items.length > 0);
    if (items.length > 0 || groups.length > 0)
      categories.push({ ...c, items, groups });
  }
  return { ...view, categories };
}

export function paletteItemCount(view: PaletteView): number {
  return view.categories.reduce(
    (n, c) =>
      n + c.items.length + c.groups.reduce((m, g) => m + g.items.length, 0),
    0,
  );
}
