process hello {
    input:
    val greeting

    """
    echo '${greeting}!'
    """
}
