process FOO {
    // a directive
    cpus 2

    input:
    // about x
    val x

    output:
    path 'out.txt' // the output

    script:
    """
    echo hi
    """
}
