nextflow.enable.types = true

def add(a:Integer,b:Integer=2)->Integer {
    a+b
}

def String describe(x) {
    return "x is ${x}"
}

def apply(items: List<Integer>, n) {
  items.collect { v -> v + n }
}

def one(a) { a }
