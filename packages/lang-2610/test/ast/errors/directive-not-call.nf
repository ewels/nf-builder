process hello {
    cpus + 1

    script:
    """
    echo hello
    """
}
