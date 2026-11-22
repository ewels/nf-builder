nextflow.enable.types = true

params {
    message: String = 'Hello world!'
}

def shout(message: String) {
    return message.toUpperCase()
}

workflow {
    main:
    println shout(params.message)
}
