workflow {
    result = channel.of(1, 2).map { it * 2 } // double
        .view()
}
