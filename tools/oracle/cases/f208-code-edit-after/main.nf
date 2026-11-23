// F-208 (UX-27, AR-24, ADR-0039): the project the Code view e2e edits. A typed entry workflow with one process call;
// the valid edit adds one call (f208-code-edit-after), the invalid edit leaves a line that doesn't parse.
nextflow.enable.types = true

process GREET {
    input:
    name: String

    output:
    line: String = stdout()

    script:
    """
    echo 'hello ${name}'
    """

    stub:
    """
    echo 'hello ${name}'
    """
}

process SHOUT {
    input:
    line: String

    output:
    loud: String = stdout()

    script:
    """
    echo '${line}' | tr a-z A-Z
    """

    stub:
    """
    echo '${line}' | tr a-z A-Z
    """
}

workflow {
    names = channel.of('ada', 'grace')
    greeted = GREET(names)
    shouted = SHOUT(greeted)
}
