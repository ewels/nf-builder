## syntax

- Groovy `import` declarations are not supported -- use fully-qualified name inline instead

## include-target

- Invalid include source: 'missing.nf' -- create the file, or correct the path in the include

## include-not-parsed

- Module could not be parsed: 'broken.nf' -- fix the syntax errors in that file first

## include-name

- Included name 'goodbye' is not defined in module 'hello.nf' -- check the name, or define it in that file

## deprecated-when

- The `when` section is deprecated -- use conditional logic in the calling workflow, or the `process.when` config option to disable a process at runtime

## deprecated-shell

- The `shell` block is deprecated, use `script` instead

## deprecated-channel

- The use of `Channel` to access channel factories is deprecated -- use `channel` instead

## implicit-it

- Implicit closure parameter is deprecated, declare an explicit parameter instead

## deprecated-directive

- The `storeDir` directive is deprecated -- use explicit workflow logic that reuses an existing output instead

## legacy-process

- Process `hello` uses legacy inputs and outputs -- migrate it to static types: give it its own script with `nextflow.enable.types = true` and typed inputs and outputs

## legacy-workflow

- The entry workflow is written in the legacy syntax -- migrate it to static types: give it its own script with `nextflow.enable.types = true` and typed inputs and outputs
- Workflow `greet` is written in the legacy syntax -- migrate it to static types: give it its own script with `nextflow.enable.types = true` and typed inputs and outputs

## legacy-params

- Legacy parameter declarations are discouraged -- use the `params` block instead

## params-outside-entry

- The use of `params` outside the entry workflow is discouraged -- pass the value in as an input instead

## tuple-where-record

- A tuple is matched by position -- use a record (`record(...)`) so values are matched by name

## publish-dir

- The `publishDir` directive is discouraged -- publish outputs from the entry workflow (`publish:` and the `output` block) instead
