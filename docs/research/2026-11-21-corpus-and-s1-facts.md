# Corpus pins and spike S1 facts

2026-11-21, researcher agent, for F-009 and F-005. Sources: GitHub API and git for pins; nextflow-io/nextflow sources at tag v26.10.7.

## F-009 corpus pins (nf-core tags are lightweight; tag SHA = commit SHA)
| repo @ ref | commit | date | files / .nf / .config | depth-1 pack |
|---|---|---|---|---|
| nf-core/rnaseq @ 3.28.0 | f24c6c0e9469d04975d87c3a8bf9020800978782 | 2026-11-12 | 900 / 106 / 148 | 7.0 MB |
| nf-core/sarek @ 3.12.0 | 786a11bb4f989751d1c4bb87908ffc6096635ff3 | 2026-11-11 | 885 / 210 / 66 | 14.7 MB |
| nf-core/fetchngs @ 1.13.0 | 955c892d80927cee633765e6e390f9cc6b7235c9 | 2026-09-15 | 159 / 14 / 15 | 0.5 MB |
| nextflow-io/rnaseq-nf @ master | 53377cff870bdb0ae02ee5cdb74703af4b18e887 | 2026-11-04 | 35 / 6 / 1 | 0.5 MB |
| nextflow-io/rnaseq-nf @ static-typing | ce09c72bc7317f89ac3e3f571a68953488229b17 | 2026-10-02 | 35 / 6 / 1 | 0.5 MB |
- rnaseq-nf master is legacy (no types flag, nextflowVersion '>=25.10.0'). Typed branch is `static-typing` (Ben Sherman, "Nextflow 26.10: Static typing, records"; nextflowVersion '>=26.10.0'; main.nf has `nextflow.enable.types = true`, `params { reads: Channel<Sample> ... }`; modules/fastqc has `input: record(id: String, fastq_1: Path, fastq_2: Path)`).
- Fetch from sandbox: `git clone --depth 1 --branch <tag>` and `git fetch --depth 1 origin <sha>` over https://github.com WORK; raw.githubusercontent.com works; api.github.com repo endpoints and codeload are 403 for repos outside this session's scope. Use git shallow fetch by SHA.

## Nextflow 26.10 patches
- v26.10.7 latest (2026-11-20, commit 0ad848ef3c3a22824cd9eb2ca14568385867702d). v26.10.6 (2026-11-12, commit 9dca05af…; "Include stage directives of typed processes in the task hash (#8071)") — LA-03 floor >=26.10.6 is real.
- Docker Hub nextflow/nextflow:26.10.0..26.10.7 exist (amd64).

## .module-info (v26.10.7 source)
- java.util.Properties file: keys `checksum` (SHA-256, 64 hex, of module dir excluding .module-info; via io.seqera:npr-client ModuleChecksum.computeDirectory — walk order unverified) and `registryUrl` (download URL). Written by ModuleStorage.groovy#L235-L238 on install; `module publish` writes same keys; `module create` writes empty file. Properties.store writes `#<date>` comment line first, escapes `:` as `\:`.
- Read back: ModuleStorage.groovy#L151-L153; version comes from meta.yml. Missing file -> warning "has no registry origin (.module-info missing)"; checksum mismatch -> treated as locally modified, reinstall aborts without -force.

## Typed/legacy interop (v26.10.7)
- (a) typed workflow calling legacy process from another file: ALLOWED (DataflowTypesTest.groovy#L119-L162 'should allow typed workflow to call legacy process/workflow'; #L211-L253 legacy multiple emit outputs read as record fields).
- (b) legacy workflow calling typed process: ALLOWED (#L74-L117).
- (c) both in one script: ERROR. Docs static-typing.mdx#L50 "A script with `nextflow.enable.types = true` cannot also contain legacy process or workflow definitions." Parser: legacy input in typed script -> "Invalid input declaration in typed process" (ScriptAstBuilder.java#L585); typed syntax without flag -> "Typed input declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script" (#L664, #L741). Untyped take in typed script -> warning "Typed workflow input should have a type annotation" (#L976). Flag takes effect from declaration point -> put at top.
- Enabling: docs/static-typing.mdx#L42-L48 "Set `nextflow.enable.types = true` in every script that uses typed processes or typed workflows … The `params` block and `output` block work without this flag." Strict parser default since 26.04.
- docs/migrations/26-10.mdx#L22-L24: `nextflow lint` reports type errors for scripts enabling types; `nextflow run` only warns. S1 must check lint outcome.
Source base: https://github.com/nextflow-io/nextflow/blob/v26.10.7/
