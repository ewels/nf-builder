include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'
include { HELLO } from './modules/local/hello/main.nf'

workflow {
    numbers = channel.of(1, 2)
    legacy_count = LEGACY_COUNT(numbers)
    legacy_count.view { v -> "n: ${v}" }
    HELLO()
}
