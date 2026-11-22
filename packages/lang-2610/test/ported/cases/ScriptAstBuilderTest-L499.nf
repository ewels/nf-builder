process hello {
    input:
    message: String

    output:
    result: String

    exec:
    result = message
}
