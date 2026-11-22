// Spike S1 (F-005, LA-13): one script enables types and defines a typed and a legacy process. Expected to fail:
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/static-typing.mdx#L50 ("A script with
// `nextflow.enable.types = true` cannot also contain legacy process or workflow definitions.");
// parser error https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java#L585,
// asserted in modules/nf-lang/src/test/groovy/nextflow/script/parser/ScriptAstBuilderTest.groovy#L544-L585.
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

workflow {
    TYPED_HELLO(channel.of('hello'))
    LEGACY_GOODBYE(channel.of('goodbye'))
}
