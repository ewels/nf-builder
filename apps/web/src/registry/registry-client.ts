import { createRegistryClient, type RegistryClient } from "@nf-builder/sources";

/** The app's client: the snapshot under BASE_URL, live only when asked (the test hook) or when LIVE_REGISTRY is on. */
export function appRegistryClient(live: boolean): RegistryClient {
  return createRegistryClient({
    snapshotUrl: new URL(
      `${import.meta.env.BASE_URL}registry/`,
      window.location.href,
    ).href,
    live,
  });
}
