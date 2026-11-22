process hello {
    cpus 1

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
