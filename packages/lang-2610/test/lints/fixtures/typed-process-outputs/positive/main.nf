nextflow.enable.types = true

process split {
    input:
    name: String

    output:
    first = stdout()
    second = file('out.txt')

    script:
    """
    echo ${name} > out.txt
    """
}
