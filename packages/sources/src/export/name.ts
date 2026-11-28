const MAX_SLUG = 100;

/** The project name made safe as a file and folder name: unsafe characters become `-` (F-404, UX-62). */
export function exportSlug(projectName: string): string {
  const slug = projectName
    // biome-ignore lint/suspicious/noControlCharactersInRegex: replacing control characters is the point
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/[.\s-]+$/, "");
  return slug === "" ? "project" : slug;
}

export const exportFileName = (projectName: string): string =>
  `${exportSlug(projectName)}.zip`;
