workflow {
    channel.of(1, 2, 3).map { it -> it * 2 }.view()
}
