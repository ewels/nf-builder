// Storage health on the main thread (F-202, IO-03): the quota warning and the one-off persistence request. `persist()` is
// Window-only and tests stub it, so this stays out of the worker. In a cross-origin frame or a private window either call
// may be missing, rejected or refused (ADR 0044); every function here degrades to "no information" and never throws.

/** The usage share from which the header warns (IO-03). */
export const QUOTA_WARNING_FRACTION = 0.8;

export interface StorageUsage {
  readonly usage: number;
  readonly quota: number;
  readonly fraction: number;
}

/** Usage and quota, or null when the browser can't say (no API, no quota, a rejected or throwing estimate). */
export async function storageUsage(
  storage: StorageManager | undefined,
): Promise<StorageUsage | null> {
  try {
    if (typeof storage?.estimate !== "function") return null;
    const { usage, quota } = await storage.estimate();
    if (
      typeof usage !== "number" ||
      typeof quota !== "number" ||
      !Number.isFinite(usage) ||
      !Number.isFinite(quota) ||
      quota <= 0
    )
      return null;
    return { usage, quota, fraction: usage / quota };
  } catch {
    return null;
  }
}

export function nearQuota(usage: StorageUsage | null): boolean {
  return usage !== null && usage.fraction >= QUOTA_WARNING_FRACTION;
}

export function storageWarningText(usage: StorageUsage): string {
  return `Storage ${Math.round(usage.fraction * 100)}% full`;
}

let requested = false;

/**
 * Asks for persistent storage, at most once per page load and only when it isn't already granted. Resolves `true` when
 * storage is persistent, `false` when the browser refused or failed, and `null` when unsupported or already asked.
 */
export async function requestPersistence(
  storage: StorageManager | undefined,
): Promise<boolean | null> {
  if (requested || typeof storage?.persist !== "function") return null;
  requested = true;
  try {
    if (typeof storage.persisted === "function") {
      try {
        if (await storage.persisted()) return true;
      } catch {
        // fall through and ask anyway
      }
    }
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}

/** For tests: forget that persistence was requested. */
export function resetPersistenceRequest(): void {
  requested = false;
}
