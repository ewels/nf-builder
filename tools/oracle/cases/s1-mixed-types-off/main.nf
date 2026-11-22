// Spike S1 (F-005, LA-13): one script without the types flag defines a legacy and a typed process. Expected to fail:
// parser error https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java#L664
// ("Typed input declaration is not allowed in legacy process"), asserted in
// modules/nf-lang/src/test/groovy/nextflow/script/parser/ScriptAstBuilderTest.groovy#L498-L542.

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
