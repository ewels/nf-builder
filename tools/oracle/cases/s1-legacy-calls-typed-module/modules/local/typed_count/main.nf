// Spike S1 (F-005): a typed process with a destructured record input, one file output, script and stub.
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process-typed.mdx#L12-L27 (flag, single unnamed file output),
// #L145-L165 (destructured record input), #L473-L475 (stub behaves as in legacy processes).
nextflow.enable.types = true

process TYPED_COUNT {
    input:
    record(
        id: String,
        reads: Path
    )

    output:
    file('count.txt')

    script:
    """
    echo '${id}' > count.txt
    wc -l < ${reads} >> count.txt
    """

    stub:
    """
    touch count.txt
    """
}
