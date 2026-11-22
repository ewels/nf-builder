// F-205 (UX-23): a legacy process (no types flag) with a tuple input and a named output.
process LEGACY_COUNT {
    input:
    tuple val(meta), path(words)

    output:
    path "${meta.id}.count.txt", emit: txt
    path "versions.txt", emit: versions

    script:
    """
    wc -w < ${words} > ${meta.id}.count.txt
    echo 'wc' > versions.txt
    """

    stub:
    """
    touch ${meta.id}.count.txt versions.txt
    """
}
