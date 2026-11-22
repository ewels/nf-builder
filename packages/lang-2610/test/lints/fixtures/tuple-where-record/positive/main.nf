nextflow.enable.types = true

process hello {
    input:
    tuple(id: String, name: String)

    output:
    tuple(id, stdout())

    script:
    """
    echo ${name}
    """
}

workflow {
    main:
    hello(tuple('a', 'b'))
}
