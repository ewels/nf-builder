export type TargetGroup =
  | "registry"
  | "raw"
  | "codeload"
  | "api.github.com"
  | "control";

export type ProbeTarget = {
  id: string;
  group: TargetGroup;
  url: string;
  purpose: string;
  openapi?: { template: string; operationId: string };
};

const REGISTRY = "https://registry.nextflow.io/api/v1";
const FASTQC = "nf-core%2Ffastqc";
const FASTQC_RELEASE = "0.0.0-6d1763b";
const FETCHNGS_SHA = "955c892d80927cee633765e6e390f9cc6b7235c9";

function registry(
  id: string,
  path: string,
  template: string,
  operationId: string,
  purpose: string,
): ProbeTarget {
  return {
    id,
    group: "registry",
    url: `${REGISTRY}${path}`,
    purpose,
    openapi: { template: `/api/v1${template}`, operationId },
  };
}

/** Everything the S4 probe calls, in report order. Lives in test code so the built app names no third-party host (IO-41). */
export const S4_TARGETS: readonly ProbeTarget[] = [
  registry(
    "registry-service-info",
    "/service-info",
    "/service-info",
    "ServiceInfoAPI_getServiceInfo",
    "Health and version",
  ),
  registry(
    "registry-modules-list",
    "/modules/list?search=fastqc&size=5",
    "/modules/list",
    "ModulesAPI_listModules",
    "Palette index (IO-31)",
  ),
  registry(
    "registry-modules-search",
    "/modules?query=fastqc&limit=3",
    "/modules",
    "ModulesAPI_searchModules",
    "Module search (UX-11)",
  ),
  registry(
    "registry-module",
    `/modules/${FASTQC}`,
    "/modules/{name}",
    "ModulesAPI_getModule",
    "Module ports (LA-23)",
  ),
  registry(
    "registry-module-releases",
    `/modules/${FASTQC}/releases`,
    "/modules/{name}/releases",
    "ModulesAPI_listModuleReleases",
    "Update available (UX-32)",
  ),
  registry(
    "registry-module-release",
    `/modules/${FASTQC}/${FASTQC_RELEASE}`,
    "/modules/{name}/{version}",
    "ModulesAPI_getModuleRelease",
    "One module release",
  ),
  registry(
    "registry-module-download",
    `/modules/${FASTQC}/${FASTQC_RELEASE}/download`,
    "/modules/{name}/{version}/download",
    "ModulesAPI_downloadModuleRelease",
    "Module bundle (IO-32); redirects to public-cr-prod.seqera.io",
  ),
  registry(
    "registry-plugins",
    "/plugins?size=100",
    "/plugins",
    "PluginsAPI_listPlugins",
    "Plugin index",
  ),
  registry(
    "registry-plugin",
    "/plugins/nf-schema",
    "/plugins/{pluginId}",
    "PluginsAPI_getPlugin",
    "Plugin with all releases",
  ),
  registry(
    "registry-plugin-release",
    "/plugins/nf-schema/2.6.1",
    "/plugins/{pluginId}/{version}",
    "PluginsAPI_getRelease",
    "Plugin spec (IO-33)",
  ),
  {
    id: "raw-pipeline-file",
    group: "raw",
    url: `https://raw.githubusercontent.com/nf-core/fetchngs/${FETCHNGS_SHA}/main.nf`,
    purpose: "GitHub import step 3 (ADR 0009); positive control",
  },
  {
    id: "codeload-zip",
    group: "codeload",
    url: "https://codeload.github.com/nf-core/fetchngs/zip/refs/tags/1.13.0",
    purpose: "Zip from GitHub (ADR 0014)",
  },
  {
    id: "api-commit",
    group: "api.github.com",
    url: "https://api.github.com/repos/nf-core/fetchngs/commits/1.13.0",
    purpose: "GitHub import step 1: ref to SHA (ADR 0009)",
  },
  {
    id: "api-tree",
    group: "api.github.com",
    url: `https://api.github.com/repos/nf-core/fetchngs/git/trees/${FETCHNGS_SHA}?recursive=1`,
    purpose: "GitHub import step 2: file tree (ADR 0009)",
  },
  {
    id: "api-zipball",
    group: "api.github.com",
    url: "https://api.github.com/repos/nf-core/fetchngs/zipball/1.13.0",
    purpose: "302 to codeload; the browser sends Origin null there",
  },
  {
    id: "github-archive",
    group: "control",
    url: "https://github.com/nf-core/fetchngs/archive/refs/tags/1.13.0.zip",
    purpose: "Negative control: github.com sends no CORS headers",
  },
];
