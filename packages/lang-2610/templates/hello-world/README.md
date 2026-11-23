# Hello world

A small typed pipeline: one process writes a greeting to a text file, and the workflow publishes it.

- `main.nf` holds the `params` block, the entry workflow and the `output` block.
- `modules/local/say_hello/main.nf` holds the process.
- `nextflow_schema.json` describes the `greeting` parameter.

Run it with `nextflow run . --greeting 'Hello again'`. The file appears in `results/greetings/`.
