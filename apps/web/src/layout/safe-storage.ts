import type { StateStorage } from "zustand/middleware";

/** Wraps a storage getter so that blocked, missing or full storage never throws. */
export function safeStorage(getStorage: () => StateStorage): StateStorage {
  const attempt = <T>(fn: (storage: StateStorage) => T, fallback: T): T => {
    try {
      return fn(getStorage());
    } catch {
      return fallback;
    }
  };
  return {
    getItem: (name) => attempt((s) => s.getItem(name), null),
    setItem: (name, value) => attempt((s) => s.setItem(name, value), undefined),
    removeItem: (name) => attempt((s) => s.removeItem(name), undefined),
  };
}
