process hello {
    output:
    stdout

    input:
    val x

    script:
    "echo $x"
}
