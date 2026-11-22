# Samplesheet to MultiQC

A typed pipeline that reads a samplesheet, runs FastQC on each sample and summarises the results in one MultiQC report.

- `main.nf` holds the `Sample` record, the `params` block, the entry workflow and the `output` block.
- `modules/local/fastqc/main.nf` and `modules/local/multiqc/main.nf` hold the two processes. Each reports its tool version to the `versions` topic.
- `assets/samplesheet.csv` and `assets/test/` hold a tiny test samplesheet and its reads.
- The `test` profile in `nextflow.config` sets `params.input` to that samplesheet.

Run it with `nextflow run . -profile test`, or pass your own samplesheet with `--input`. Results appear in `results/`.
