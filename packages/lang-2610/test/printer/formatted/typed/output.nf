nextflow.enable.types = true

workflow {

    main:
    ch = channel.of(1, 2)
    d = file('x.txt')

    publish:
    ch = ch
    d = d
}

output {
    // the numbers
    ch: Channel<Integer> {
        path 'numbers'
        index {
            path 'index.csv'
            header(['a', 'b'])
            sep '\t'
        }
    }
    d: Path {
        path '.'
        mode 'copy'
    }
}
