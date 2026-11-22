process greet {
    input:
    val greeting
    val name

    output:
    val message

    exec:
    message = "${greeting}, ${name}!"
}
