// F-108 LA-10: the same kind of code statements in a typed workflow (nextflow.enable.types = true), in its own file
// because the types flag is per file (LA-13).
nextflow.enable.types = true

workflow TYPED_TAIL {
    take:
    names: Channel<String>

    main:
    def prefix = 'typed'
    suffix = prefix + '-tail'
    log.info("suffix ${suffix}")
    out = names.map { n -> "${n}-${suffix}" }

    emit:
    out: Channel<String> = out
}
