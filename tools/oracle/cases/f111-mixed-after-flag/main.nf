// F-111 (LA-13): a legacy process before `nextflow.enable.types = true` and a typed one after it, in one script.
// Lint and run accept it: the typed/legacy split depends on position, so LA-13 needs the app's own check.
// Docs say a typed script cannot contain legacy definitions:
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/static-typing.mdx#L50
process LEGACY_GOODBYE {
    input:
    val message

    output:
    path 'goodbye.txt'

    script:
    """
    echo '${message}' > goodbye.txt
    """

    stub:
    """
    touch goodbye.txt
    """
}

nextflow.enable.types = true

process TYPED_HELLO {
    input:
    message: String

    output:
    file('hello.txt')

    script:
    """
    echo '${message}' > hello.txt
    """

    stub:
    """
    touch hello.txt
    """
}

workflow {
    TYPED_HELLO(channel.of('hello'))
    LEGACY_GOODBYE(channel.of('goodbye'))
}
