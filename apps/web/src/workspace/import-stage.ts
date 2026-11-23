// Staging of an import in the engine worker (F-403, ADR 0003, ADR 0045). A zip is read here, so its file text never
// reaches the page: the page gets a summary, and `createProject` copies the selected files from the stage. The
// `@nf-builder/sources` module (fflate included) is loaded on the first `stageZip`, so it is a separate worker chunk.
import type {
  ImportedFile,
  ImportLimits,
  ImportRefusal,
  ImportSummary,
  ZipRead,
} from "@nf-builder/sources";
import type { ImportStageResult } from "./types";

/** The `sources` exports the stager uses. */
export type SourcesModule = Pick<
  typeof import("@nf-builder/sources"),
  | "checkArchiveSize"
  | "DEFAULT_IGNORE"
  | "IMPORT_LIMITS"
  | "importProblem"
  | "parseIgnore"
  | "readZip"
  | "refuse"
  | "selectFiles"
  | "summarise"
>;

/** The files to store, or the message that stops Create. A refusal has the same shape. */
export type ImportFilesResult =
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
  readonly now?: () => number;
  readonly limits?: ImportLimits;
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

  const gone = (m: SourcesModule): ImportRefusal => m.refuse("gone");
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
      const m = await module();
      stage = undefined;
      const limits = options.limits ?? m.IMPORT_LIMITS;
      const tooBig = m.checkArchiveSize(file.size, limits);
      if (tooBig) return tooBig;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = m.readZip(bytes, { limits, now: options.now });
      if (!read.ok) return read;
      const staged: Stage = { id: newId(), source: name, read };
      stage = staged;
      return result(staged, summaryOf(m, staged, m.DEFAULT_IGNORE));
    },

    restage: async (id, ignore) => {
      const m = await module();
      if (stage?.id !== id) return gone(m);
      return result(stage, summaryOf(m, stage, ignore));
    },

    files: async (id, ignore) => {
      const m = await module();
      if (stage?.id !== id) return gone(m);
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
