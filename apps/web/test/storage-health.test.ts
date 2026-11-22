import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  nearQuota,
  QUOTA_WARNING_FRACTION,
  requestPersistence,
  resetPersistenceRequest,
  storageUsage,
  storageWarningText,
} from "../src/project/storage-health";

const manager = (parts: Partial<StorageManager>) => parts as StorageManager;
const quota = (usage: number, total = 100) =>
  manager({ estimate: async () => ({ usage, quota: total }) });

beforeEach(() => resetPersistenceRequest());

describe("F-202 storage health", () => {
  it("F-202 step 3 IO-03: usage at 85% and at 80% of quota warns; 79% doesn't", async () => {
    expect(QUOTA_WARNING_FRACTION).toBe(0.8);
    const at85 = await storageUsage(quota(85));
    expect(at85).toEqual({ usage: 85, quota: 100, fraction: 0.85 });
    expect(nearQuota(at85)).toBe(true);
    expect(nearQuota(await storageUsage(quota(80)))).toBe(true);
    expect(nearQuota(await storageUsage(quota(79)))).toBe(false);
  });

  it("F-202 IO-03 ADR-0044: no storage manager, no estimate API, a zero quota, a rejected or throwing estimate gives no warning", async () => {
    expect(await storageUsage(undefined)).toBeNull();
    expect(await storageUsage(manager({}))).toBeNull();
    expect(await storageUsage(quota(5, 0))).toBeNull();
    expect(
      await storageUsage(
        manager({ estimate: async () => ({ usage: undefined, quota: 100 }) }),
      ),
    ).toBeNull();
    expect(
      await storageUsage(
        manager({ estimate: () => Promise.reject(new Error("no")) }),
      ),
    ).toBeNull();
    expect(
      await storageUsage(
        manager({
          estimate: () => {
            throw new Error("SecurityError");
          },
        }),
      ),
    ).toBeNull();
    expect(nearQuota(null)).toBe(false);
  });

  it("F-202 IO-03: persistence is requested once per page load and only when not persisted; unsupported is a no-op", async () => {
    const persist = vi.fn(async () => true);
    const storage = manager({ persisted: async () => false, persist });
    expect(await requestPersistence(storage)).toBe(true);
    expect(await requestPersistence(storage)).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);

    resetPersistenceRequest();
    const again = vi.fn(async () => true);
    expect(
      await requestPersistence(
        manager({ persisted: async () => true, persist: again }),
      ),
    ).toBe(true);
    expect(again).not.toHaveBeenCalled();

    resetPersistenceRequest();
    expect(await requestPersistence(undefined)).toBeNull();
    expect(await requestPersistence(manager({}))).toBeNull();
  });

  it("F-202 IO-03 ADR-0044: a refused, rejected or throwing persist() reports false and never throws", async () => {
    expect(
      await requestPersistence(
        manager({ persisted: async () => false, persist: async () => false }),
      ),
    ).toBe(false);
    resetPersistenceRequest();
    expect(
      await requestPersistence(
        manager({
          persisted: async () => false,
          persist: () => Promise.reject(new Error("NotAllowedError")),
        }),
      ),
    ).toBe(false);
    resetPersistenceRequest();
    expect(
      await requestPersistence(
        manager({
          persisted: () => {
            throw new Error("SecurityError");
          },
          persist: () => {
            throw new Error("SecurityError");
          },
        }),
      ),
    ).toBe(false);
  });

  it('F-202 IO-03: the warning reads "Storage 85% full"', () => {
    expect(storageWarningText({ usage: 85, quota: 100, fraction: 0.85 })).toBe(
      "Storage 85% full",
    );
  });
});
