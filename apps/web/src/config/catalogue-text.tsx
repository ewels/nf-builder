// Catalogue descriptions as React elements (F-601, FI-04): paragraphs, inline code, emphasis, https links and fenced
// code, and nothing else. Never `innerHTML`; anything else stays text, so catalogue data can't inject markup.
import type { JSX, ReactNode } from "react";

// `[:][/][/]` rather than a literal scheme, so the host check doesn't take the pattern for a URL (IO-41)
const READ_MORE = /\n*\[Read more\]\(https?[:][/][/][^)\s]*\)\s*$/;

/** The description without its closing "[Read more](…)" paragraph, which the details pane replaces with its own link. */
export function withoutReadMore(markdown: string): string {
  return markdown.replace(READ_MORE, "").trimEnd();
}

const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\((https[:][/][/][^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > at) out.push(text.slice(at, index));
    const key = `i${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined && m[3] !== undefined)
      out.push(
        <a key={key} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>,
      );
    else if (m[4] !== undefined) out.push(<strong key={key}>{m[4]}</strong>);
    else out.push(<em key={key}>{m[5]}</em>);
    at = index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function CatalogueText({
  markdown,
}: {
  readonly markdown: string;
}): JSX.Element {
  const blocks: JSX.Element[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;
  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`b${blocks.length}`}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (fence === null) {
        flush();
        fence = [];
      } else {
        blocks.push(
          <pre key={`b${blocks.length}`}>
            <code>{`${fence.join("\n")}\n`}</code>
          </pre>,
        );
        fence = null;
      }
    } else if (fence !== null) fence.push(line);
    else if (line.trim() === "") flush();
    else paragraph.push(line.trim());
  }
  flush();
  if (fence !== null)
    blocks.push(
      <pre key={`b${blocks.length}`}>
        <code>{`${fence.join("\n")}\n`}</code>
      </pre>,
    );
  return <div className="catalogue-text">{blocks}</div>;
}
