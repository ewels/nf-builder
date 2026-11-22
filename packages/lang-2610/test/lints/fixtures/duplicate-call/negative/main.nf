include { HELLO as HELLO_2 } from './hello.nf'

process HELLO {
    input:
    val x

    output:
    stdout

    script:
    """
    echo ${x}
    """
}

workflow INNER {
    take:
    xs

    main:
    HELLO(xs)

    emit:
    out = HELLO.out
}

workflow {
    HELLO(channel.of(1))
    INNER(channel.of(3))
    INNER(channel.of(4))
    if (params.extra) {
        HELLO_2(channel.of(5))
    } else {
        HELLO_2(channel.of(6))
    }
}
