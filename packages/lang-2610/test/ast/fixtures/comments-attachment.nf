#!/usr/bin/env nextflow
/**
 * Say hello to someone.
 *
 * @param name the person to greet
 */
process HELLO {
    // directives first
    cpus 1 // one is enough

    input:
    val name // who to greet

    output:
    stdout

    script:
    // the command
    """
    echo 'Hello ${name}'
    """
    // dangling at the end of the script section
}

/* entry workflow */
workflow {
    channel.of('a', 'b') // source
        // a comment between chain links
        .map { v -> v.toUpperCase() } // upper-case it
        .set { names }
    HELLO(
        names // the only argument
    )
    def config = [
        // leading a map entry
        greeting: 'hi', // trailing a map entry
    ]
    if( config.greeting ) {
        println 'yes'
    }
    // before else
    else {
        println 'no'
    }
    // dangling at the end of the workflow
}
// dangling at the end of the file
