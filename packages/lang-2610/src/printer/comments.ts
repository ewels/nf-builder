// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/Comments.java and
// Comment.java (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE).
import type { AstNode, Comment } from "@nf-builder/lang-core";
import { walk } from "@nf-builder/lang-core";

/** The comment text as the formatter sees it: CRLF and CR to LF (our comments keep the source text). */
export function commentText(comment: Comment): string {
  return comment.text.replace(/\r\n?/g, "\n");
}

/** `Comment.normalize`: every run of whitespace becomes one space, and the ends are stripped. */
export function normaliseComment(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Every comment in the slots of the subtree under `node`, the node included. */
export function attachedComments(node: AstNode): Comment[] {
  const out: Comment[] = [];
  walk(node, (n) => {
    out.push(
      ...(n.leadingComments ?? []),
      ...(n.trailingComments ?? []),
      ...(n.danglingComments ?? []),
    );
    return undefined;
  });
  return out;
}
