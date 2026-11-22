process LEGACY_COUNT {
    input:
    path reads

    output:
    path 'count.txt', emit: txt

    script:
    """
    wc -l ${reads} > count.txt
    """
}
