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
}

output {
    result {
        path 'again'
    }
}
