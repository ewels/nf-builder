import type { JSX } from "react";

/** Splits `text` at backtick-quoted segments: `Replace \`a\` with \`b\`` gives text, code, text, code. */
export function quotedParts(
  text: string,
): readonly { readonly text: string; readonly code: boolean }[] {
  return text
    .split(/`([^`]+)`/)
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((p) => p.text !== "");
}

/**
 * Text with its backtick-quoted segments in `<code>` and the backticks dropped (F-309): a fix title reads "Replace
 * `Channel` with `channel`" in the engine, and the button's accessible name is the same words without the backticks.
 */
export function QuotedText({ text }: { readonly text: string }): JSX.Element {
  return (
    <>
      {quotedParts(text).map((p, i) =>
        p.code ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static parts of one string
          <code key={i}>{p.text}</code>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
