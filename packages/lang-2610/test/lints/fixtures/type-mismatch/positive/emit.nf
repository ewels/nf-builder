nextflow.enable.types = true

workflow numbers {
    take:
    names: Channel<String>

    main:
    greeted = names

    emit:
    greeted: Channel<Integer>
}

workflow {
    numbers(channel.of('a', 'b'))
}
