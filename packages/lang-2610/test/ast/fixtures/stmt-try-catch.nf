def text = null
try {
    text = file('hello.txt').text
}
catch( e: IOException ) {
    log.warn "Could not load hello.txt"
}
catch( e: FileNotFoundException | java.nio.file.AccessDeniedException ) {
    log.warn "Could not load hello.txt"
}
catch( e ) {
    log.warn "Unexpected error: ${e}"
}
