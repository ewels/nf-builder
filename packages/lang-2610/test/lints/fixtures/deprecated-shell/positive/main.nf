process hello {
    input:
    val x

    shell:
    '''
    echo !{x}
    '''
}

workflow {
    hello(channel.of(1, 2))
}
