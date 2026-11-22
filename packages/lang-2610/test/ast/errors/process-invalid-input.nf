process hello {
    input:
    x = 1

    script:
    """
    echo hello
    """
}
