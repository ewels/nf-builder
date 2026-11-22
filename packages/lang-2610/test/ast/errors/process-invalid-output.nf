process hello {
    output:
    x = 1

    script:
    """
    echo hello
    """
}
