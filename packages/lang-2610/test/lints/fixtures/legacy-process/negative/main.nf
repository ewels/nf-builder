nextflow.enable.types = true

process hello {
    input:
    x: String

    output:
    stdout()

    script:
    """
    echo ${x}
    """
}

workflow {
    main:
    greeting = hello('a')
    println greeting
}
