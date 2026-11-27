// Registry module folders (UX-16, AR-03, ADR 0034): found with the pack's own include rules, so nested vendoring and the
// main.nf plus meta.yml requirement match what a script's include resolves.
import type { IncludeRules, ProjectTree } from "@nf-builder/lang-core";
import type { RegistryFolder } from "./types";

/**
 * A folder `D` holding `meta.yml` is a registry folder when some split `D = B/modules/R` makes `scriptInclude` resolve
 * reference `R` from a script in `B` to `D/main.nf`. The `local` scope is our own convention (CreateProcess writes
 * there) and is never a registry module.
 */
export function registryFolders(
  paths: readonly string[],
  includes: IncludeRules,
  tree: ProjectTree,
): readonly RegistryFolder[] {
  const out: RegistryFolder[] = [];
  for (const path of paths) {
    if (path !== "meta.yml" && !path.endsWith("/meta.yml")) continue;
    const dir = path.slice(0, -"meta.yml".length - 1);
    if (dir === "") continue;
    const segments = dir.split("/");
    for (let i = segments.length - 2; i >= 0; i--) {
      if (segments[i] !== "modules") continue;
      const base = segments.slice(0, i).join("/");
      const reference = segments.slice(i + 1).join("/");
      if (segments[i + 1] === "local") continue;
      const target = includes.scriptInclude(
        base === "" ? "main.nf" : `${base}/main.nf`,
        reference,
        tree,
      );
      if (
        target.kind === "file" &&
        target.path === `${dir}/main.nf` &&
        target.module === reference
      ) {
        out.push({ path: dir, module: reference });
        break;
      }
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
