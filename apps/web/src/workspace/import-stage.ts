// Staging of an import in the engine worker (F-403, ADR 0003, ADR 0045). A zip is read here, so its file text never
// reaches the page: the page gets a summary, and `createProject` copies the selected files from the stage. The
// `@nf-builder/sources/import` module (fflate included) is loaded on the first `stageZip`, so it is a separate worker chunk.
import type {
  ImportedFile,
  ImportSummary,
  ZipRead,
} from "@nf-builder/sources/import";
import type { ImportStageResult, NamedBlob } from "./types";

export type SourcesModule = typeof import("@nf-builder/sources/import");

/** The files to store, or the message that stops Create. A refusal has the same shape. */
type ImportFilesResult =
  | { readonly ok: true; readonly files: readonly ImportedFile[] }
  | { readonly ok: false; readonly message: string };

export interface ImportStager {
  stageZip(file: Blob, name: string): Promise<ImportStageResult>;
  restage(id: string, ignore: string): Promise<ImportStageResult>;
  /** Stages loose files (F-210): the same limits and text check as a zip, with no ignore list. */
  stageFiles(files: readonly NamedBlob[]): Promise<ImportStageResult>;
  /** `keepFolder` puts a stripped top-level folder back on every path (F-210). */
  files(
    id: string,
    ignore: string,
    options?: { readonly keepFolder?: boolean },
  ): Promise<ImportFilesResult>;
  discard(id: string): void;
}

interface Stage {
  readonly id: string;
  readonly source: string;
  readonly read: ZipRead;
  /** Loose files take no ignore list: the user chose each of them. */
  readonly loose: boolean;
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
  const load = options.load ?? (() => import("@nf-builder/sources/import"));
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
      ignore: s.loose ? "" : ignore,
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
      const staged: Stage = { id: newId(), source: name, read, loose: false };
      stage = staged;
      return result(staged, summaryOf(m, staged, m.DEFAULT_IGNORE));
    },

    stageFiles: async (files) => {
      const mine = ++generation;
      const m = await module();
      stage = undefined;
      const total = files.reduce((sum, f) => sum + f.blob.size, 0);
      const refused = m.checkLooseFiles(files.length, total);
      if (refused) return refused;
      const entries = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          size: f.blob.size,
          bytes:
            f.blob.size > m.IMPORT_LIMITS.maxTextFileBytes
              ? null
              : new Uint8Array(await f.blob.arrayBuffer()),
        })),
      );
      if (mine !== generation) return m.refuse("gone");
      const staged: Stage = {
        id: newId(),
        source:
          files.length === 1 ? (files[0]?.name ?? "") : `${files.length} files`,
        read: m.looseCandidates(entries),
        loose: true,
      };
      stage = staged;
      return result(staged, summaryOf(m, staged, ""));
    },

    restage: async (id, ignore) => {
      const m = await module();
      if (stage?.id !== id) return m.refuse("gone");
      return result(stage, summaryOf(m, stage, ignore));
    },

    files: async (id, ignore, options = {}) => {
      const m = await module();
      if (stage?.id !== id) return m.refuse("gone");
      const problem = m.importProblem(summaryOf(m, stage, ignore));
      if (problem !== null) return { ok: false, message: problem };
      const chosen = m.selectFiles(
        stage.read.candidates,
        m.parseIgnore(stage.loose ? "" : ignore),
      );
      const { stripped } = stage.read;
      return {
        ok: true,
        files:
          options.keepFolder && stripped !== null
            ? chosen.map((f) => ({ ...f, path: `${stripped}/${f.path}` }))
            : chosen,
      };
    },

    discard: (id) => {
      if (stage?.id === id) stage = undefined;
    },
  };
}
