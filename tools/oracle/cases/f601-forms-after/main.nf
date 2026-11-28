// F-601 (FI-02, FI-06): two typed processes, one labelled big_mem, so a withLabel selector matches one process.
nextflow.enable.types = true

process GREET {
    input:
    name: String

    output:
    line: String = stdout()

    script:
    """
    echo 'hello ${name} (${task.memory})'
    """

    stub:
    """
    echo 'hello ${name} (${task.memory})'
    """
}

process SHOUT {
    label 'big_mem'

    input:
    line: String

    output:
    loud: String = stdout()

    script:
    """
    echo "${task.memory}: ${line.trim()}" | tr a-z A-Z
    """

    stub:
    """
    echo "${task.memory}: ${line.trim()}" | tr a-z A-Z
    """
}

workflow {
    names = channel.of('ada', 'grace')
    loud = SHOUT(GREET(names))
    loud.view()
}
