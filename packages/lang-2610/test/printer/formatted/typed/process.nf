// Typed process (untidy on purpose)
nextflow.enable.types = true

/**
 * Align reads.
 */
process ALIGN {
    // directives
    tag 'align'
    publishDir([path: 'results', mode: 'copy'])
    cpus 2 // trailing
    memory 2.GB

    input:
    // the sample
    sample: String
    reads: Path
    tuple(prefix: String, index: Path)
    record(
        id: String,
        fastq: Path
    )

    stage:
    stageAs reads, 'reads/*'
    env 'PREFIX', prefix

    output:
    bam: Path = file('*.bam')
    log: Path = file('*.log') // log file
    out: String = stdout()

    topic:
    stdout() >> 'versions'

    when:
    sample != 'skip'

    script:
    """
    align ${reads}
      --out ${prefix}
    """

    stub:
    """
    touch out.bam
    """

    // nothing else
}
