process LEGACY_COUNT {
    input:
    val x

    output:
    path 'count.txt'

    script:
    """
    echo ${x} > count.txt
    """
}
