process greet {
    // directives
    errorStrategy 'retry'
    tag { "${greeting}/${name}" }

    input:
    val greeting
    val name

    output:
    stdout

    script: // or exec:
    """
    echo '${greeting}, ${name}!'
    """

    stub:
    """
    # do nothing
    """
}
