try {
    println(file('foo.txt').text)
}
catch (e: IOException) {
    log.warn("Could not load foo.txt")
}
