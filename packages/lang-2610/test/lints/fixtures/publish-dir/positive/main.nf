process hello {
    publishDir 'results', mode: 'copy'

    output:
    path 'hello.txt'

    script:
    """
    echo hello > hello.txt
    """
}

workflow {
    hello()
}
