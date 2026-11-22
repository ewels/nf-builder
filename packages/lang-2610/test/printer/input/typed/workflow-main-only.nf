nextflow.enable.types = true

workflow {
    main:
    x = channel.of(1, 2, 3)
    x.view()
}
