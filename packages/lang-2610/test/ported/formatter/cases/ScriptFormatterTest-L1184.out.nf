workflow {
    x = [1, 2, 2, 3].reduce([:]) { acc, v ->
        // 'acc' collects all values
        acc[v] = 1
        return acc // give it back
    }
}
