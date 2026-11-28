// Where the Nextflow docs describe a config scope or option (F-601, FI-04). The page lists come from the v26.10.7 docs tree
// (`docs/reference/config/*.mdx`, `docs/reference/process/directives/*.mdx`) and were checked against docs.seqera.io.
import type { ConfigCatalogue, ConfigNode } from "@nf-builder/lang-core";

const BASE = "https://docs.seqera.io/nextflow/";

/** `reference/config/<page>`: one page per scope, and `unscoped` for the top-level options. `agent` has none. */
export const SCOPE_PAGES: readonly string[] = [
  "apple-container",
  "apptainer",
  "aws",
  "azure",
  "charliecloud",
  "conda",
  "dag",
  "docker",
  "env",
  "executor",
  "fusion",
  "google",
  "k8s",
  "lineage",
  "mail",
  "manifest",
  "nextflow",
  "notification",
  "podman",
  "registry",
  "report",
  "sarus",
  "seqera",
  "shifter",
  "singularity",
  "smolvm",
  "spack",
  "timeline",
  "tower",
  "trace",
  "unscoped",
  "wave",
  "workflow",
];

/** `reference/process/directives/<page>`: every process option of the catalogue except `when`. */
export const DIRECTIVE_PAGES: readonly string[] = [
  "accelerator",
  "after-script",
  "arch",
  "array",
  "before-script",
  "cache",
  "cluster-options",
  "conda",
  "container",
  "container-options",
  "cpus",
  "debug",
  "disk",
  "error-strategy",
  "executor",
  "ext",
  "fair",
  "hints",
  "label",
  "machine-type",
  "max-errors",
  "max-forks",
  "max-retries",
  "max-submit-await",
  "memory",
  "module",
  "penv",
  "pod",
  "publish-dir",
  "queue",
  "resource-labels",
  "resource-limits",
  "scratch",
  "secret",
  "shell",
  "spack",
  "stage-in-mode",
  "stage-out-mode",
  "store-dir",
  "tag",
  "time",
];

const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The catalogue node a path names, or null. */
function find(
  catalogue: ConfigCatalogue,
  names: readonly string[],
): ConfigNode | null {
  let nodes: readonly ConfigNode[] = catalogue.scopes;
  let found: ConfigNode | null = null;
  for (const name of names) {
    found =
      nodes.find((n) => n.kind !== "placeholder" && n.name === name) ??
      nodes.find((n) => n.kind === "placeholder") ??
      null;
    if (found === null) return null;
    nodes =
      found.kind === "scope" || found.kind === "placeholder"
        ? found.children
        : [];
  }
  return found;
}

/** The "Read more" link of a node's description, when it points into the Nextflow docs. */
const readMore = (node: ConfigNode): string | null => {
  const link = [
    ...node.description.matchAll(/\[Read more\]\((https:\/\/[^)\s]+)\)/g),
  ].pop()?.[1];
  return link?.startsWith(BASE) ? link : null;
};

/**
 * A page of the Nextflow docs for a config path, or null when the catalogue doesn't know the path. The page rules are
 * those of the docs tree; a path no rule covers falls back to the catalogue's own link, then to `reference/config`.
 */
export function configDocsUrl(
  catalogue: ConfigCatalogue,
  names: readonly string[],
): string | null {
  const node = find(catalogue, names);
  if (node === null) return null;
  const [scope] = names;
  if (scope === "params") return `${BASE}config#parameters`;
  if (scope === "profiles") return `${BASE}config#config-profiles`;
  if (scope === "plugins") return `${BASE}plugins`;
  if (scope === "process") {
    const option = names[1];
    if (names.length === 2 && option !== undefined) {
      const page = kebab(option);
      if (DIRECTIVE_PAGES.includes(page))
        return `${BASE}reference/process/directives/${page}`;
    }
    return `${BASE}config#process-configuration`;
  }
  if (names.length === 1 && node.kind === "option")
    return `${BASE}reference/config/unscoped#${names[0]?.toLowerCase()}`;
  const page = kebab(scope as string);
  if (SCOPE_PAGES.includes(page)) {
    const anchor = names.length > 1 ? `#${names.join("").toLowerCase()}` : "";
    return `${BASE}reference/config/${page}${anchor}`;
  }
  return readMore(node) ?? `${BASE}reference/config`;
}
