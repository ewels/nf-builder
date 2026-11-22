process greet {
    input:
    val greeting
    val name

    exec:
    message = "${greeting}, ${name}!"

    output:
    val message
}
