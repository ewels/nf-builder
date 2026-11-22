def compute(xs, ys) {
    // wrapped chain with a namespace receiver
    def result = channel.of(1, 2, 3)
        .map { v -> v * 2 }
        .filter { v -> v > 2 }
        .view()
    // comments between links
    def other = channel.of(1, 2)
        .map { v -> v + 1 } // plus one
        // keep the big ones
        .filter { v -> v > 2 }
    def one = { v -> v }
    def many = { v ->
        def w = v * 2
        w + 1
    }
    def nested = [1, 2,
        3,
    ]
    def named = file('a.txt', checkIfExists: true, hidden: true)
    def reorder = file(checkIfExists: true, 'b.txt')
    def pick = xs.size() > 1
        ? xs.first()
        : ys.first()
    return [one, many, nested, named, reorder, pick, result, other]
}
