// Spike S1 (F-005, LA-14): records that `nextflow lint` does not check a legacy input's shape. A typed caller passes the
// one-component tuple(...) to LEGACY_COUNT, whose input declares two components (val(meta), path(reads)); lint accepts it and
// the mismatch fails only at run time. Legacy process inputs and outputs are untyped to the type checker:
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/main/java/nextflow/script/control/TypeCheckingVisitor.java#L990-L994
// and #L1027-L1033. Otherwise the same as s1-typed-calls-legacy-module.
nextflow.enable.types = true

include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    ch_reads = channel.fromPath("${projectDir}/data/*.txt")
        .map { reads -> tuple([id: reads.baseName]) }
    legacy_out = LEGACY_COUNT(ch_reads)
    legacy_out.txt.view { v -> "txt: ${v}" }
    legacy_out.versions.view { v -> "versions: ${v}" }
}
