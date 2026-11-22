try {
    println(file('hello.txt').text)
}
catch (e: IOException) {
    log.warn("Could not load hello.txt")
}
