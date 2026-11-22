nextflow.enable.types = true

workflow {
    main:
    ch = channel.of(1)

    publish:
    a = ch
    b: Channel<String> = ch
}

output {
    a: Channel<Integer> {
        path 'a'
    }
    b: Channel<Integer> {
        path 'b'
    }
}
