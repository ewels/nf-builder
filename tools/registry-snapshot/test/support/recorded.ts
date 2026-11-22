import { fileURLToPath } from "node:url";
import { createRegistryApi } from "../../src/api.ts";
import type { ApiModule, ApiPlugin } from "../../src/api-types.ts";
import { replayFetch } from "../../src/recording.ts";
import { readModuleTarGz } from "../../src/tar.ts";

export const recordedDir = fileURLToPath(
  new URL("../fixtures/recorded", import.meta.url),
);
export const expectedDir = fileURLToPath(
  new URL("../fixtures/expected", import.meta.url),
);

/** The API client over the recorded responses (F-501 replay layout). */
export const recordedApi = () =>
  createRegistryApi({ fetch: replayFetch(recordedDir), sleep: async () => {} });

export const recordedModule = (name: string): Promise<ApiModule> =>
  recordedApi().getModule(name);
export const recordedPlugin = (id: string): Promise<ApiPlugin> =>
  recordedApi().getPlugin(id);
export const recordedTarGz = (
  name: string,
  version: string,
): Promise<Uint8Array> => recordedApi().downloadModule(name, version);

/** A recorded bundle's text files, by path. */
export async function recordedBundleText(
  name: string,
  version: string,
): Promise<Map<string, string>> {
  const files = readModuleTarGz(await recordedTarGz(name, version));
  return new Map(
    files.flatMap((f) => ("text" in f ? [[f.path, f.text] as const] : [])),
  );
}
