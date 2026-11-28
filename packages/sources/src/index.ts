export type { SnapshotModulePorts } from "@nf-builder/lang-core";
export * from "./import/index.ts";
export { createRegistryClient, LIVE_REGISTRY } from "./registry/client.ts";
export { RegistryError, toFailure } from "./registry/errors.ts";
export { createLiveClient, overlayLive } from "./registry/live.ts";
export { createSnapshotClient } from "./registry/snapshot.ts";
export type {
  RegistryClient,
  RegistryErrorCode,
  RegistryFailure,
  RegistryIndex,
  RegistryModule,
  RegistryReadOptions,
  RegistrySource,
} from "./registry/types.ts";
export type { ModuleGroup, RegistryMatches } from "./registry/view.ts";
export {
  createRegistrySearch,
  groupModules,
  moduleMarks,
  namespaceOf,
  shortName,
} from "./registry/view.ts";
