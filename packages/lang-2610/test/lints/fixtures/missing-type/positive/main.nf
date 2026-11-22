nextflow.enable.types = true

process greet {
    input:
    name

    output:
    stdout()

    script:
    """
    echo ${name}
    """
}

workflow shout {
    take:
    names

    main:
    greeted = names.map { n -> n.toUpperCase() }

    emit:
    greeted: Channel<String>
}
