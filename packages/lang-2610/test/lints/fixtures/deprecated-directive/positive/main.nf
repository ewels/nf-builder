process hello {
    storeDir 'cache'

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
