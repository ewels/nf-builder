workflow {
    main:
    ch = channel.of(1)

    publish:
    ch.view()
}

output {
    result {
        path '.'
    }
}
