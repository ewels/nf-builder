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

## missing-type

- Process input should have a type annotation -- add a type, such as `name: String`
- Process input should have a type annotation -- add a type, such as `q: String`
- Tuple component should have a type annotation -- add a type, such as `a: String`
- Tuple component should have a type annotation -- add a type, such as `b: String`
- Typed workflow input should have a type annotation -- add a type, such as `names: String`

## typed-process-outputs

- Typed process should have only one output -- consider combining outputs into a record

## publish-type-ignored

- Workflow output type should be declared in the output block -- the type annotation in the publish statement is ignored

## feature-flag

- Unrecognized feature flag 'nextflow.enable.typess' -- use one of nextflow.enable.configProcessNamesValidation, nextflow.enable.dsl, nextflow.enable.moduleBinaries, nextflow.enable.strict, nextflow.enable.types, nextflow.preview.recursion, or remove it

## pipeline-include-types

- Including a pipeline requires `nextflow.enable.types = true` in the including script -- add `nextflow.enable.types = true` to this script

## config-include-placement

- Config includes are only allowed at the top-level or in a profile -- move it to the top level or into a profile

## agent-output

- Agent output `b` has unsupported field `meta` with type Map -- supported types are Boolean, Float, Integer, List<E>, Path, String, or a record type
- Agent output `items` has unsupported type List -- supported types are Boolean, Float, Integer, List<E>, Path, String, or a record type
- Agent output `q` should declare a type -- typed outputs are answered by the model
- `eval` is not defined -- use `stdout()`, `file()` or `files()` in an agent output

## include-alias

- An included pipeline must be aliased, e.g. `params as MY_PIPELINE`
- An included pipeline must be aliased, e.g. `workflow as MY_PIPELINE`
- Included types cannot be aliased -- remove the alias

## duplicate-name

- `hello` is already included -- remove the duplicate, or rename one or alias it with `as`
