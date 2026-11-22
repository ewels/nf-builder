// A catch type keeps its package unless it is a default import (catch-package)
def read(path) {
    try {
        println file(path).text
    }
    catch (java.io.IOException e) {
        println 'io'
    }
    catch (java.nio.file.AccessDeniedException e) {
        println 'denied'
    }
}
