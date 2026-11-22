nextflow.enable.types = true

process hello {
    input:
    sample: Record

    output:
    record(id: sample.id, greeting: stdout())

    script:
    """
    echo ${sample.id}
    """
}

workflow {
    main:
    hello(record(id: 'a'))
}
