process ALIGN {
    tag "${meta.id}"
    label 'process_medium'
    cpus 2
    memory 4.GB
    publishDir 'results', mode: 'copy'

    input:
    tuple val(meta), path(reads)
    path index, stageAs: 'index/*'
    file legacy_file
    env 'GENOME'
    stdin
    each mode

    output:
    tuple val(meta), path('*.bam'), emit: bam
    path '*.log', optional: true, emit: log
    env 'RESULT', emit: result
    eval('samtools --version'), topic: versions
    stdout emit: out

    when:
    task.ext.when == null || task.ext.when

    shell:
    '''
    aligner !{reads} > !{meta.id}.bam
    '''
}
