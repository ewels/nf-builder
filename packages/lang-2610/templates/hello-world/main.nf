nextflow.enable.types = true

include { SAY_HELLO } from './modules/local/say_hello/main.nf'

params {
    greeting: String = 'Hello, world!'
}

/**
 * Writes the greeting to a text file and publishes it.
 */
workflow {

    main:
    greetings = channel.of(params.greeting)
    greeting_file = SAY_HELLO(greetings)

    publish:
    greeting_file = greeting_file
}

output {
    greeting_file: Channel<Path> {
        path 'greetings'
    }
}
