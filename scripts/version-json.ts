import type { Plugin } from "vite";

type VersionInfo = { commit: string; context: string };

export function versionInfo(
  env: Record<string, string | undefined>,
): VersionInfo {
  return { commit: env.COMMIT_REF ?? "local", context: env.CONTEXT ?? "local" };
}

/** Emits /version.json so the deploy check can tell which commit is live. */
export function versionJson(env: Record<string, string | undefined>): Plugin {
  return {
    name: "nf-builder:version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(versionInfo(env)),
      });
    },
  };
}
