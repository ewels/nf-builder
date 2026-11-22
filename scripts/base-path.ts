/**
 * ADR 0040: the public base path of the build, from `BASE_PATH` (configure-pages' `base_path`).
 * Always absolute with a trailing slash; never `./`, which `import.meta.env.BASE_URL` would carry into workers.
 */
export function basePath(env: Record<string, string | undefined>): string {
  const value = env.BASE_PATH;
  if (value === undefined || value === "") return "/";
  if (!value.startsWith("/") || value.startsWith("//"))
    throw new Error(
      `BASE_PATH must be an absolute path such as /my-site/, got "${value}"`,
    );
  return value.endsWith("/") ? value : `${value}/`;
}
