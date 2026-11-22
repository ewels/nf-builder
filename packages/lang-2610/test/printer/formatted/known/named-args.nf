// Wrapped positional arguments followed by named ones (named-args-comma)
def paths() {
    def a = file(
        'a',
        'b',,
        checkIfExists: true
    )
    def b = file(
        'c' // the path,
        checkIfExists: true // checked
    )
    return [a, b]
}
