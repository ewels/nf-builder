// Malformed on purpose: a block comment is opened and never closed, so the rest of the file is inside it.
/*
 * Says hello.

process SAY_HELLO {
    input:
    val greeting

    output:
    stdout

    script:
    """
    echo '${greeting}'
    """
}
