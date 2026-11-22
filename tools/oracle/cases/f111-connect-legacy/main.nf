// F-111 (LA-21, AR-22): the forms Connect writes between legacy processes: a call assigned to a variable and read by
// emit name (`g.named`), by position (`G.out[1]`) and as a whole (`u`), and `null` padding for a missing earlier input.
process G {
    input:
    tuple val(meta), path(reads)
    path x

    output:
    tuple val(meta), path('o.txt'), emit: named
    path 'u.txt'

    script:
    """
    touch o.txt u.txt
    """

    stub:
    """
    touch o.txt u.txt
    """
}

process U {
    input:
    path x

    output:
    path 'v.txt'

    script:
    """
    touch v.txt
    """

    stub:
    """
    touch v.txt
    """
}

process V {
    input:
    path x

    output:
    path 'w.txt'

    script:
    """
    touch w.txt
    """

    stub:
    """
    touch w.txt
    """
}

workflow {
    a = channel.of(file('main.nf'))
    g = G(channel.of(tuple('m', file('main.nf'))), a)
    u = U(g.named.map { meta, f -> f })
    V(G.out[1])
}
