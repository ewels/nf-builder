nextflow.enable.types = true

include { Sample } from '../../../types.nf'

process DESCRIBE {
    input:
    sample: Sample

    output:
    file('description.txt')

    script:
    """
    echo ${sample.id} > description.txt
    """

    stub:
    """
    touch description.txt
    """
}
