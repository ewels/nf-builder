process hello {
    input:
    val name

    stage:
    env 'NAME', name

    script:
    """
    echo \$NAME
    """
}
