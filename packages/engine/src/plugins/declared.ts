import type { ConfigSourceFile, Range } from "@nf-builder/lang-core";

export interface DeclaredPlugin {
  readonly id: string;
  /** null: declared without `@version`. */
  readonly version: string | null;
  /** The `id '...'` statement. */
  readonly range: Range;
}

/**
 * The plugins the root config declares (IO-33): every string `id` in its top-level `plugins` blocks, in source order.
 * Plugins inside profiles, and ids that aren't string literals, aren't counted.
 */
export function declaredPlugins(file: ConfigSourceFile): DeclaredPlugin[] {
  const found: DeclaredPlugin[] = [];
  for (const s of file.ast?.statements ?? []) {
    if (s.kind !== "ConfigApplyBlock" || s.name.name !== "plugins") continue;
    for (const apply of s.statements) {
      const arg = apply.args[0];
      if (apply.name.name !== "id" || arg?.kind !== "String") continue;
      const at = arg.value.indexOf("@");
      found.push({
        id: at < 0 ? arg.value : arg.value.slice(0, at),
        version: at < 0 ? null : arg.value.slice(at + 1),
        range: apply.range,
      });
    }
  }
  return found;
}
