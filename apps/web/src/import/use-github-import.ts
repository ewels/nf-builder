// The GitHub source's state behind the New project dialog (F-401, UX-61): the two form fields, the review of the repository
// and the ignore list. Review lists the repository once; editing the ignore list or reviewing the same repository and ref again
// re-plans from that listing without a request. Changing the repository or ref goes back to the Review step.
import { DEFAULT_IGNORE, type ImportPlan } from "@nf-builder/sources";
import { parseRepoInput, repoSlug } from "@nf-builder/sources/github";
import { useEffect, useRef, useState } from "react";
import {
  githubClient,
  review as listRepository,
  type Review,
  replan,
} from "./github-import";
import { importErrorMessage } from "./messages";

export type GithubImportState =
  | { readonly status: "idle" }
  | { readonly status: "checking"; readonly slug: string }
  | {
      readonly status: "ready";
      readonly review: Review;
      /** The text in the box. */
      readonly ignore: string;
      readonly plan: ImportPlan;
    }
  | { readonly status: "failed"; readonly message: string };

export interface GithubImportView {
  readonly state: GithubImportState;
  readonly repo: string;
  readonly ref: string;
  setRepo(text: string): void;
  setRef(text: string): void;
  setIgnore(text: string): void;
  review(): Promise<void>;
  reset(): void;
}

/** One import per mount: its listing is dropped when the dialog goes. */
export function useGithubImport(): GithubImportView {
  const [repo, setRepoText] = useState("");
  const [ref, setRefText] = useState("");
  const [state, setState] = useState<GithubImportState>({ status: "idle" });
  const listed = useRef<{ key: string; review: Review } | null>(null);
  const ignore = useRef(DEFAULT_IGNORE);
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const edited = () => {
    run.current += 1;
    controller.current?.abort();
    setState({ status: "idle" });
  };
  return {
    state,
    repo,
    ref,
    setRepo(text) {
      setRepoText(text);
      edited();
    },
    setRef(text) {
      setRefText(text);
      edited();
    },
    setIgnore(text) {
      ignore.current = text;
      setState((current) =>
        current.status === "ready"
          ? { ...current, ignore: text, plan: replan(current.review, text) }
          : current,
      );
    },
    reset() {
      edited();
    },
    async review() {
      const key = `${repo.trim()}\n${ref.trim()}`;
      const mine = ++run.current;
      const parsed = parseRepoInput(repo, ref);
      const name = "error" in parsed ? repo.trim() : repoSlug(parsed.repo);
      const fail = (error: unknown) => {
        if (mine === run.current)
          setState({
            status: "failed",
            message: importErrorMessage(error, {
              repo: name,
              ref: "error" in parsed ? null : parsed.ref,
            }),
          });
      };
      try {
        let r = listed.current?.key === key ? listed.current.review : null;
        if (r === null) {
          setState({ status: "checking", slug: name });
          controller.current = new AbortController();
          r = await listRepository(
            githubClient(),
            { repo, ref },
            controller.current.signal,
          );
          listed.current = { key, review: r };
        }
        if (mine !== run.current) return;
        setState({
          status: "ready",
          review: r,
          ignore: ignore.current,
          plan: replan(r, ignore.current),
        });
      } catch (error) {
        fail(error);
      }
    },
  };
}
