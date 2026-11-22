workflow {
    result = channel.of(1, 2)
        .map { it * 2 }
        // about the filter
        .filter { it > 2 }
        .view()
}
