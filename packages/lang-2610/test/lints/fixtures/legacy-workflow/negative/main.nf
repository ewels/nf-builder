nextflow.enable.types = true

workflow greet {
    take:
    names: Channel<String>

    main:
    greeted = names.map { n -> n.toUpperCase() }

    emit:
    greeted: Channel<String>
}

workflow {
    main:
    greet(channel.of('a')).view()
}
