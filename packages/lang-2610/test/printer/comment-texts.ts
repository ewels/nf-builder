// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/Comments.java
// `textsOf` (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE): the normalised comment texts of a script,
// sorted, so the comments of two texts can be compared for equality.
import { parseScriptAst } from "../../src/ast/index.ts";
import { normaliseComment } from "../../src/printer/comments.ts";

export function commentTexts(text: string): string[] {
  const result = parseScriptAst(text);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  const { shebang, comments } = result.ast;
  return [...(shebang ? [shebang] : []), ...comments]
    .map((c) => normaliseComment(c.text))
    .sort();
}
