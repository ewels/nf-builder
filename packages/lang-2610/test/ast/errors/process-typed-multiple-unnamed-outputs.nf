nextflow.enable.types = true

process hello {
    input:
    name: String

    output:
    stdout()
    file('*.txt')

    script:
    """
    echo ${name}
    """
}
