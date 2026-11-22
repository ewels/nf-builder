workflow WORKFLOW {
    take:
    ch_input      // channel: [ val(meta), [ fastq ] ]
    val_reference //  string: the reference key

    main:
    ch_out = ch_input

    emit:
    ch_out                           // channel: out
    versions = ch_out                // channel: versions
    summary  = ch_out.map { v -> v } // channel: summary
}
