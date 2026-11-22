// Project names (F-202, UX-01): trimmed, 1 to 100 characters, duplicates allowed.
export const PROJECT_NAME_MAX = 100;
export const DEFAULT_PROJECT_NAME = "Untitled project";

/** The trimmed name, or null when it is empty or longer than `PROJECT_NAME_MAX` characters. */
export function normaliseProjectName(name: string): string | null {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= PROJECT_NAME_MAX ? trimmed : null;
}
