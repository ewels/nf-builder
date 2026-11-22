nextflow.enable.types = true

include { FASTQC_LEGACY } from '../../la14/modules/local/fastqc_legacy/main.nf'

workflow {
    meta = record(id: 'a')
    reads = file('a.fastq')
    reports = FASTQC_LEGACY(tuple(meta, reads))
}
