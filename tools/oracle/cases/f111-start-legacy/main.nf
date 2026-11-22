include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    numbers = channel.of(1, 2)
    LEGACY_COUNT(numbers)
    numbers.view { v -> "n: ${v}" }
}
