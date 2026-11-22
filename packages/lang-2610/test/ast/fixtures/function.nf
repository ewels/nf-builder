def greet(greeting, name) {
    println "${greeting}, ${name}!"
}

def add(a: Integer, b: Integer) -> Integer {
    a + b
}

// return with no value
def greetIfNamed(greeting, name) {
    if( !greeting || !name )
        return
    println "${greeting}, ${name}!"
}

// return a value
def fib(x) {
    if( x <= 1 )
        return x
    fib(x - 1) + fib(x - 2)
}
