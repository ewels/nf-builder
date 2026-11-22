process hello {
    input:
    val name

    output:
    stdout

    topic:
    eval('bash --version') >> 'versions'

    script:
    """
    echo ${name}
    """
}
