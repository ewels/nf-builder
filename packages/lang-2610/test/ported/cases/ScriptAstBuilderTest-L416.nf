workflow {
    main:
    a = channel.of(1)

    publish:
    a
}

output {
    a {
        path 'a'
    }
}
