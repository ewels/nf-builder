nextflow.enable.types = true

workflow {
    x = channel.of(1, 2, 3)
    x.view()
}
