export type PaletteMessageKind = "none" | "no-match" | "no-language-match";

/** `registryCount` is null when the registry isn't ready. Only a search with no match anywhere gets the status message. */
export function paletteMessage(
  genericCount: number,
  registryCount: number | null,
): PaletteMessageKind {
  if (genericCount > 0) return "none";
  return registryCount !== null && registryCount > 0
    ? "no-language-match"
    : "no-match";
}
