include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    numbers = channel.of(1, 2)
    LEGACY_COUNT(numbers)
    LEGACY_COUNT.out.view { f -> "count: ${f}" }
}
