workflow {
    main:
    ch = channel.of(1)

    publish:
    result = ch
}

output {
    result {
        path '.'
    }
    println 'not an output'
}
