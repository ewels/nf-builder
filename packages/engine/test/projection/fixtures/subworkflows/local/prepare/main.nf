nextflow.enable.types = true

include { ALIGN ; INDEX } from '../../../modules/local/align'

record Sample {
    id: String
    reads: Path
}

workflow PREPARE {
    take:
    samples: Channel<Sample>
    fasta: Path

    main:
    index = INDEX(fasta)
    aligned = ALIGN(samples, index)
    bams = aligned.bam.map { b -> b }
    def probe1: Boolean = index
    def probe2: Boolean = aligned
    def probe3: Boolean = bams

    emit:
    bams: Channel<Path>
    logs = aligned.log
    index
}
