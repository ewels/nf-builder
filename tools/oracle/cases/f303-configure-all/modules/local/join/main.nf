nextflow.enable.types = true

/**
 * Joins two words with a tag.
 *
 * @param left the first word
 */
process JOIN {
    storeDir 'cache'
    cpus 2
    time 1.h

    input:
    right: String
    first: String
    record(
        tag: String
    )

    stage:
    env 'WORDS', first
    env 'LABEL', right

    output:
    joined: Path = file('joined.txt')

    topic:
    eval('tool --version') >> 'tool_versions'

    script:
    """
    echo ${first} ${right} ${tag} > joined.txt
    """

    stub:
    'touch joined.txt'
}
