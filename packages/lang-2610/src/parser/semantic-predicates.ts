// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/SemanticPredicates.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE).
// Character streams hold code points in both antlr4ng and nf-lang (CharStreams.fromReader), so columns count code points
// and the surrogate-pair branches of the Java original never match here; they are not ported.
import type { CharStream } from "antlr4ng";
import { isJavaIdentifierPart } from "./java-character.ts";

/** Whether the next character in the stream is one of `chars`. */
export function isFollowedBy(cs: CharStream, ...chars: string[]): boolean {
  const c1 = cs.LA(1);
  return chars.some((c) => c.codePointAt(0) === c1);
}

/** Whether the next character can follow a "$" in a GString or slashy string as a path or "{". A lone "$" cannot. */
export function isFollowedByJavaLetterInGString(cs: CharStream): boolean {
  const c1 = cs.LA(1);
  if (c1 === 0x24) return false; // "$"
  if (
    (c1 >= 0x61 && c1 <= 0x7a) || // a-z
    (c1 >= 0x41 && c1 <= 0x5a) || // A-Z
    c1 === 0x5f || // _
    c1 === 0x7b // {
  )
    return true;
  return c1 > 0x7f && isJavaIdentifierPart(c1);
}
