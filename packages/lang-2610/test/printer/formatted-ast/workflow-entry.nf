workflow {

    main:
    greetings = channel.of('Bonjour', 'Ciao', 'Hello', 'Hola')
    messages = greetings.map { v -> "${v} world!" }
    greetings.view { v -> "${v} world!" }

    publish:
    messages = messages

    onComplete:
    log.info('Workflow completed successfully!')

    onError:
    log.error('Workflow failed.')
}

output {
    messages {
        path '.'
    }
}
