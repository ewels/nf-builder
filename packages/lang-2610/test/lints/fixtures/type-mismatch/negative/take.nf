nextflow.enable.types = true

workflow shout {
    take:
    names: Channel<String>

    main:
    greeted = names.map { n -> n.toUpperCase() }

    emit:
    greeted: Channel<String>
}

workflow {
    shout(channel.of('a', 'b'))
}
