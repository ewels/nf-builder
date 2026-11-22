def add = { a, b -> a + b }
def square = { v ->
    println('Hello!')
    println("We're in a closure!")
    println('Goodbye...')
    v * v
}
def typed = { a: Integer, b: Integer = 1 -> a + b }
def noParams = { 42 }
def implicit = { it * 2 }
def legacyTyped = { s: String -> s.size() }
