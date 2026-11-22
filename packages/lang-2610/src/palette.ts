// The 26.10 palette overlay (ADR 0005, ADR 0025), from palette.json (generated from palette.yaml by pnpm gen:palette).
// Reached through `pack.palette` (ADR 0028).
import type { PaletteDefinition } from "@nf-builder/lang-core";
import json from "../palette.json" with { type: "json" };

export const palette = json as PaletteDefinition;
