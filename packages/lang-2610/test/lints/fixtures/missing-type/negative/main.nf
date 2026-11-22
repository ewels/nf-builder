nextflow.enable.types = true

process greet {
    input:
    name: String

    output:
    stdout()

    script:
    """
    echo ${name}
    """
}

workflow shout {
    take:
    names: Channel<String>

    main:
    greeted = names.map { n -> n.toUpperCase() }

    emit:
    greeted: Channel<String>
}
