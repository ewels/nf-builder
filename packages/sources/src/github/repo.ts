export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

export interface RepoInput {
  readonly repo: RepoRef;
  readonly ref: string | null;
}

export type RepoInputError = "empty" | "not-github" | "invalid";

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export const repoSlug = (r: RepoRef): string => `${r.owner}/${r.name}`;

/**
 * IO-10: `owner/name` or a github.com address (`.git`, a trailing slash, `www.`, `/tree/<ref>`). A ref typed in the
 * ref field wins over the one in the address.
 */
export function parseRepoInput(
  repo: string,
  ref: string,
): RepoInput | { error: RepoInputError } {
  let text = repo.trim();
  if (text === "") return { error: "empty" };
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(text);
  if (scheme !== null) text = text.slice(scheme[0].length);
  const segments = text.split("/");
  const first = segments[0] ?? "";
  if (scheme !== null || first.includes(".")) {
    if (!/^(www\.)?github\.com$/i.test(first)) return { error: "not-github" };
    segments.shift();
  }
  while (segments.length > 0 && segments[segments.length - 1] === "")
    segments.pop();
  const owner = segments[0] ?? "";
  let name = segments[1] ?? "";
  if (name.endsWith(".git")) name = name.slice(0, -4);
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..")
    return { error: "invalid" };
  let urlRef: string | null = null;
  if (segments.length > 2) {
    if (segments[2] !== "tree" || segments.length < 4)
      return { error: "invalid" };
    urlRef = segments.slice(3).join("/");
  }
  const typed = ref.trim();
  return {
    repo: { owner, name },
    ref: typed !== "" ? typed : urlRef,
  };
}
