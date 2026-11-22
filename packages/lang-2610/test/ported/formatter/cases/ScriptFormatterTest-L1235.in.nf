workflow {
    result = channel.of(1, 2)
        .map { it * 2 } // double
        .filter { it > 2 }
        .view()
}
