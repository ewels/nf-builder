// F-601 (FI-06): selectors against a named workflow, a labelled process and one process included twice under aliases.
nextflow.enable.types = true

include { TWICE as TWICE_A } from './modules/local/twice'
include { TWICE as TWICE_B } from './modules/local/twice'

process GREET {
    input:
    name: String

    output:
    line: String = stdout()

    script:
    """
    echo "GREET ${task.ext}"
    """

    stub:
    """
    echo "GREET ${task.ext}"
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
    echo "SHOUT ${task.ext}"
    """

    stub:
    """
    echo "SHOUT ${task.ext}"
    """
}

workflow GREETING {
    take:
    names: Channel<String>

    main:
    greeted = GREET(names)

    emit:
    greeted
}

workflow {
    names = channel.of('ada')
    greeted = GREETING(names)
    loud = SHOUT(greeted)
    TWICE_A(loud).view()
    TWICE_B(loud).view()
    greeted.view()
    loud.view()
}
