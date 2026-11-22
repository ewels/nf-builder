nextflow.enable.types = true

workflow numbers {
    take:
    names: Channel<String>

    main:
    greeted = names.map { n -> n.toUpperCase() }

    emit:
    greeted: Channel<Integer>
}

workflow {
    numbers(channel.of('a', 'b'))
}
