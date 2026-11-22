// F-205: a legacy named workflow (no types flag), in its own file because the flag is per file (LA-13).
workflow LEGACY_TAIL {
    take:
    items

    main:
    tagged = items.map { v -> "tail:${v}" }

    emit:
    tagged
}
