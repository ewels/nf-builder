// F-107 (LA-21): legacy processes that use every input qualifier (val, path, file, tuple, each, env, stdin) and every
// output form (emit:, topic:, optional:, a lone unnamed output, several unnamed outputs).
// Syntax: https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process.mdx#L577-L664 (inputs, each, env, stdin),
// #L1002-L1020 (tuple output), #L1065-L1089 (emit), #L1117-L1135 (optional) and docs/process.mdx topic outputs.
process ALL_INPUTS {
    input:
    val sample
    path reads
    file extra
    tuple val(meta), path(bam), val('tag')
    each flag
    env 'GREETING'
    stdin

    output:
    tuple val(meta), path("${meta.id}.out.txt"), emit: result
    path 'versions.txt', emit: versions
    path 'maybe.txt', optional: true, emit: maybe
    val sample, emit: sample
    tuple val("${task.process}"), eval('echo 1'), topic: versions_topic

    script:
    """
    touch ${meta.id}.out.txt versions.txt
    """

    stub:
    """
    touch ${meta.id}.out.txt versions.txt
    """
}

process ONE_UNNAMED {
    input:
    val x

    output:
    path 'one.txt'

    script:
    """
    touch one.txt
    """

    stub:
    """
    touch one.txt
    """
}

process MANY_UNNAMED {
    input:
    val x

    output:
    path 'first.txt'
    val x
    tuple val(x), path('third.txt')

    script:
    """
    touch first.txt third.txt
    """

    stub:
    """
    touch first.txt third.txt
    """
}
