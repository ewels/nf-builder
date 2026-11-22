process hello {
    input:
    val message

    output:
    val result

    exec:
    result = message
}
