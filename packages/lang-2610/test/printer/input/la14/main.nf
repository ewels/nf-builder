nextflow.enable.types = true

include { FASTQC_LEGACY } from './modules/local/fastqc_legacy/main.nf'

// LA-14: a tuple argument for a legacy input is built with tuple(...)
workflow {
    main:
    meta = record(id: 'a')
    reads = file('a.fastq')
    reports = FASTQC_LEGACY(tuple(meta, reads))
}
