// Dropping and choosing files for the Files view (F-210, UX-16). Pure helpers, and the guard that keeps a stray file drop
// from navigating the page away.
import { useEffect } from "react";

/** A drag that carries files (as opposed to text or a link). */
export const isFileDrag = (types: readonly string[]): boolean =>
  types.includes("Files");

export type DropKind =
  | { readonly kind: "zip"; readonly file: File }
  | { readonly kind: "files"; readonly files: readonly File[] }
  | { readonly kind: "folder" }
  | { readonly kind: "none" };

const isZip = (file: File): boolean =>
  /\.zip$/i.test(file.name) ||
  file.type === "application/zip" ||
  file.type === "application/x-zip-compressed";

/**
 * What was dropped or chosen. `entries` come from `webkitGetAsEntry()` and are null where the browser gives none (a
 * synthetic drop), which counts as a file. Exactly one zip is a zip; anything else is loose files; a directory is refused.
 */
export function dropKind(
  files: readonly File[],
  entries: readonly ({ readonly isDirectory: boolean } | null)[],
): DropKind {
  if (entries.some((e) => e?.isDirectory === true)) return { kind: "folder" };
  const [only] = files;
  if (files.length === 0 || only === undefined) return { kind: "none" };
  if (files.length === 1 && isZip(only)) return { kind: "zip", file: only };
  return { kind: "files", files };
}

/** Where the panel handles file drops itself. */
export const DROP_ZONE_ATTRIBUTE = "data-file-drop";

/** Stops a file dropped anywhere but the Files panel from opening in place of the app (F-210). */
export function useFileDropGuard(): void {
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (!isFileDrag([...(event.dataTransfer?.types ?? [])])) return;
      if (
        event.target instanceof Element &&
        event.target.closest(`[${DROP_ZONE_ATTRIBUTE}]`) !== null
      )
        return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    document.addEventListener("dragover", guard);
    document.addEventListener("drop", guard);
    return () => {
      document.removeEventListener("dragover", guard);
      document.removeEventListener("drop", guard);
    };
  }, []);
}
