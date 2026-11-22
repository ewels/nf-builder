// F-205: a typed named workflow with take and emit, fed a channel and a plain Path.
nextflow.enable.types = true

workflow SHOUT {
    take:
    names: Channel<String>
    words: Path

    main:
    loud = names.map { n -> "${n.toUpperCase()} ${words.baseName}" }

    emit:
    loud: Channel<String> = loud
}
