nextflow.enable.types=true

process HELLO {
    input:
    name: String

    output:
    greeting: String = "Hello, ${name}!"

    script:
    "echo ${name}"
}

// a named workflow
workflow greet {
    take:
    names: Channel<String>   // the names

    main:
    greetings = names.map { n -> n.trim() }.map { n -> "Hi ${n}" }

    emit:
    greetings: Channel<String>
    count = names.count()
}

workflow {
    main:
    names = channel.of('a','b')
    greeted = greet(names)
    done = greeted.greetings.view { v -> "got ${v}" }

    publish:
    results: Channel<String> = greeted.greetings
    summary = greeted.count

    onComplete:
    log.info 'done'

    onError:
    log.error 'failed' // oops
}

output {
    results: Channel<String> {
        path 'results'
    }
    summary: Value<Integer> {
        path '.'
    }
}
