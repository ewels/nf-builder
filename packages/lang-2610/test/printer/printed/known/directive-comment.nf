// A directive wrapped by a comment keeps its parentheses (directive-comment)
process HELLO {
    memory(
        // enough for the index
        2.GB
    )
    cpus 2

    script:
    """
    echo hello
    """
}
