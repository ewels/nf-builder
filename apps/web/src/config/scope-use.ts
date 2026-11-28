import type { ConfigViewItem } from "@nf-builder/engine";

/** The scopes a list of items already has, for the Add scope dialog to mark. */
export const scopeItemsInUse = (
  items: readonly ConfigViewItem[],
): Set<string> =>
  new Set(
    items.flatMap((i) =>
      i.kind === "scope" && i.card.scope !== "" ? [i.card.scope] : [],
    ),
  );
