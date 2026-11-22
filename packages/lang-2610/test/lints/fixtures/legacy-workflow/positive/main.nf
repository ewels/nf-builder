workflow greet {
    take:
    names

    main:
    greeted = names.map { n -> n.toUpperCase() }

    emit:
    greeted
}

workflow {
    greet(channel.of('a')).view()
}
