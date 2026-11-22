nextflow.enable.types = true

params {
    message: String = 'Hello world!'
}

def shout() {
    return params.message.toUpperCase()
}

workflow {
    main:
    println shout()
}
