// Staging of an import in the engine worker (F-403, ADR 0003, ADR 0045). A zip is read here, so its file text never
// reaches the page: the page gets a summary, and `createProject` copies the selected files from the stage. The
// `@nf-builder/sources` module (fflate included) is loaded on the first `stageZip`, so it is a separate worker chunk.
import type { ImportedFile, ImportSummary, ZipRead } from "@nf-builder/sources";
import type { ImportStageResult } from "./types";

export type SourcesModule = typeof import("@nf-builder/sources");

/** The files to store, or the message that stops Create. A refusal has the same shape. */
type ImportFilesResult =
  | { readonly ok: true; readonly files: readonly ImportedFile[] }
  | { readonly ok: false; readonly message: string };

export interface ImportStager {
  stageZip(file: Blob, name: string): Promise<ImportStageResult>;
  restage(id: string, ignore: string): Promise<ImportStageResult>;
  files(id: string, ignore: string): Promise<ImportFilesResult>;
  discard(id: string): void;
}

interface Stage {
  readonly id: string;
  readonly source: string;
  readonly read: ZipRead;
}

/** `getRandomValues` works in insecure contexts, where `crypto.randomUUID` doesn't (ADR 0044). */
const stageId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

interface StagerOptions {
  readonly load?: () => Promise<SourcesModule>;
  readonly newId?: () => string;
}

export function createImportStager(options: StagerOptions = {}): ImportStager {
  const load = options.load ?? (() => import("@nf-builder/sources"));
  const newId = options.newId ?? stageId;
  let sources: Promise<SourcesModule> | undefined;
  const module = (): Promise<SourcesModule> => {
    sources ??= load();
    return sources;
  };
  /** One stage is kept at a time; a newer one replaces it. */
  let stage: Stage | undefined;
  /** Counts `stageZip` calls: reads can finish out of order, and only the newest call may stage. */
  let generation = 0;

  const summaryOf = (m: SourcesModule, s: Stage, ignore: string) =>
    m.summarise({
      source: s.source,
      stripped: s.read.stripped,
      candidates: s.read.candidates,
      ignore,
    });
  const result = (s: Stage, summary: ImportSummary): ImportStageResult => ({
    ok: true,
    id: s.id,
    summary,
  });

  return {
    stageZip: async (file, name) => {
      const mine = ++generation;
      const m = await module();
      stage = undefined;
      const tooBig = m.checkArchiveSize(file.size);
      if (tooBig) return tooBig;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (mine !== generation) return m.refuse("gone");
      const read = m.readZip(bytes);
      if (!read.ok) return read;
      const staged: Stage = { id: newId(), source: name, read };
      stage = staged;
      return result(staged, summaryOf(m, staged, m.DEFAULT_IGNORE));
    },

    restage: async (id, ignore) => {
      const m = await module();
      if (stage?.id !== id) return m.refuse("gone");
      return result(stage, summaryOf(m, stage, ignore));
    },

    files: async (id, ignore) => {
      const m = await module();
      if (stage?.id !== id) return m.refuse("gone");
      const problem = m.importProblem(summaryOf(m, stage, ignore));
      if (problem !== null) return { ok: false, message: problem };
      return {
        ok: true,
        files: m.selectFiles(stage.read.candidates, m.parseIgnore(ignore)),
      };
    },

    discard: (id) => {
      if (stage?.id === id) stage = undefined;
    },
  };
}
