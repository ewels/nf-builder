nextflow.enable.types = true

workflow numbers {
    take:
    names: Channel<String>

    main:
    greeted = names

    emit:
    greeted: Channel<String>
}

workflow {
    numbers(channel.of('a', 'b'))
}
