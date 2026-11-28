nextflow.enable.types = true

include { SORT } from '../sort/main.nf'

workflow ALIGN {
    take:
    reads: Channel<String>
    index: Channel<String>

    main:
    sorted = SORT(reads).sorted

    emit:
    bam: Channel<String> = sorted
}
