nextflow.enable.types = true

// a record
record Sample {
    id: String // identifier
    reads: Path?
    tags: List<String>
    extra: Map<String, Integer>
}

record R {

    a: String

    b: Path
}

record Pair {
    left: Sample

    right: Sample?

    // end
}
