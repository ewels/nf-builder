// F-205 (UX-22): a legacy process shaped like an nf-core module, included by its registry name 'nf-core/wordcount'.
// Written for this fixture, not copied. A registry module needs main.nf and meta.yml (ModuleResolver).
process WORDCOUNT {
    tag "${meta.id}"

    input:
    tuple val(meta), path(words)

    output:
    tuple val(meta), path("${meta.id}.words.txt"), emit: counts

    script:
    """
    wc -w < ${words} > ${meta.id}.words.txt
    """

    stub:
    """
    touch ${meta.id}.words.txt
    """
}
