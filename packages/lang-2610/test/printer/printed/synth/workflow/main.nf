nextflow.enable.types = true

include { helper } from '../../typed/lib/a.nf'
include { third } from '../../typed/lib/b.nf'

params {
    greeting: String = 'Hello'
}

workflow greet {
    take:
    names: Channel<String>

    main:
    greetings = names.map { n -> "${params.greeting}, ${n}!" }

    emit:
    greetings: Channel<String>
}

workflow {

    main:
    names = channel.of('a', 'b')
    result = greet(names)

    publish:
    greetings = result
}

output {
    greetings: Channel<String> {
        path 'greetings'
    }
}
