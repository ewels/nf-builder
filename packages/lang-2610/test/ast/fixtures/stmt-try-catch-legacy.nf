try {
    println file('hello.txt').text
}
catch( IOException e ) {
    log.warn "Could not load hello.txt"
}
