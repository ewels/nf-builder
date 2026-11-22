// A catch type keeps its package unless it is a default import (catch-package)
def read(path) {
    try {
        println(file(path).text)
    }
    catch (e: IOException) {
        println('io')
    }
    catch (e: java.nio.file.AccessDeniedException) {
        println('denied')
    }
}
