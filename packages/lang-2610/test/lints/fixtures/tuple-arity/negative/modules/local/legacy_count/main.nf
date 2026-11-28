// Spike S1 (F-005): a legacy process shaped like an nf-core module (no types flag): tag, tuple input,
// named tuple and path outputs, script and stub. Shape from
// https://github.com/nf-core/modules/blob/bbd7054a060ab558521f3c6601df5323c96362fd/modules/nf-core/fastqc/main.nf#L5-L17 and #L54-L59;
// syntax from https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process.mdx#L646-L664 (tuple input),
// #L1002-L1020 (tuple output), #L1065-L1085 (emit), #L277-L304 (stub).
process LEGACY_COUNT {
    tag "${meta.id}"

    input:
    tuple val(meta), path(reads)

    output:
    tuple val(meta), path("${meta.id}.count.txt"), emit: txt
    path 'versions.txt', emit: versions

    script:
    """
    wc -l < ${reads} > ${meta.id}.count.txt
    echo 'wc' > versions.txt
    """

    stub:
    """
    touch ${meta.id}.count.txt
    touch versions.txt
    """
}
