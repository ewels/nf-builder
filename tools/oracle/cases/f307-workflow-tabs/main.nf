// F-307 (UX-50, UX-51): a typed entry workflow that calls a named workflow twice, once under an alias; ALIGN calls SORT.
// The F-307 tests open ALIGN and SORT in tabs, add a take and an emit, and compare with the oracle cases f307-add-*.
nextflow.enable.types = true

include { ALIGN } from './subworkflows/local/align/main.nf'
include { ALIGN as MAP } from './subworkflows/local/align/main.nf'

workflow {
    main:
    reads = channel.of('a', 'b')
    aligned = ALIGN(reads)
    aligned.view()
    mapped = MAP(reads)
    mapped.view()
}
