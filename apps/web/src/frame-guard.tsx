// QA-30, ADR 0040: GitHub Pages can't send frame-ancestors or X-Frame-Options, so the app refuses to start in a frame.

/** True when the page is inside another page (a cross-origin `top` also compares as different). */
export function isFramed(win: { top: unknown; self: unknown }): boolean {
  return win.top !== win.self;
}

export function FramedNotice({ href }: { href: string }) {
  return (
    <div className="framed-notice" role="alert">
      <p>nf-builder can't run inside another page.</p>
      <a href={href} target="_blank" rel="noopener noreferrer">
        Open in a new tab
      </a>
    </div>
  );
}
