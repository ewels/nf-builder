// The palette overlay contract (ADR 0005, ADR 0025): what a pack's palette.yaml (mirrored to palette.json) contains.
// Types only, like catalogue.ts.

/** The seven generic categories, in UX-12 order. */
export type PaletteCategoryId =
  | "processes"
  | "workflows"
  | "factories"
  | "operators"
  | "params-outputs"
  | "types-functions-includes"
  | "plugins-config";
/** UX-12's operator groups. A pack omits a group when all its operators are legacy-only. */
export type OperatorGroupId =
  | "transform"
  | "filter"
  | "combine"
  | "fork"
  | "split"
  | "reduce"
  | "inspect";
export type PaletteIcon =
  | "process"
  | "agent"
  | "workflow"
  | "include"
  | "factory"
  | "operator"
  | "params"
  | "output"
  | "record"
  | "enum"
  | "function"
  | "plugin"
  | "config";

type PaletteItemBase = {
  /** Overrides the category icon; the web app maps it to a glyph. */
  icon?: PaletteIcon;
  /** Extra search terms (UX-11). */
  keywords?: string[];
  /** https://docs.seqera.io/nextflow/... */
  docs?: string;
  /** UX-13 badge; needs `docs`. */
  preview?: boolean;
};

/**
 * Names a catalogue entry: factory -> script.factories, operator -> script.operators (any receiver),
 * config -> a top-level node of config.json. Label and description come from the catalogue.
 * Key: `${kind}:${name}`.
 */
export type CatalogueItem = PaletteItemBase & {
  kind: "factory" | "operator" | "config";
  name: string;
};

/** Names a rule of the pack's script grammar (a scriptDeclaration alternative). Key: `id`. */
export type ConstructItem = PaletteItemBase & {
  kind: "construct";
  name: string;
  id: string;
  label: string;
  description: string;
};

export type PaletteItem = CatalogueItem | ConstructItem;
export type PaletteGroup = {
  id: OperatorGroupId;
  label: string;
  items: PaletteItem[];
};
/** Exactly one of `items` or `groups`. */
export type PaletteCategory = {
  id: PaletteCategoryId;
  label: string;
  icon: PaletteIcon;
  items?: PaletteItem[];
  groups?: PaletteGroup[];
};
export type PaletteDefinition = { categories: PaletteCategory[] };
