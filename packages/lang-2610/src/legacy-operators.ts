// Operators that legacy (DSL 2) workflows may call but the catalogue lacks, because the language server's operator
// signatures come from the typed standard library (LA-02: version data lives in the pack). Result kinds are the
// `*Returns:*` lines of docs/reference/operator.mdx at v26.10.7 (Apache-2.0, see docs/licences.md): "dataflow value" is
// `value`, "channel" and "queue channel" are `channel`; `set` returns nothing and `tap` names its source, so both
// are `assign` (AR-14).

import type { LegacyOperator } from "@nf-builder/lang-core";

export const legacyOperators: readonly LegacyOperator[] = [
  { name: "buffer", result: "channel" },
  { name: "collate", result: "channel" },
  { name: "concat", result: "channel" },
  { name: "countFasta", result: "value" },
  { name: "countFastq", result: "value" },
  { name: "countJson", result: "value" },
  { name: "countLines", result: "value" },
  { name: "distinct", result: "channel" },
  { name: "first", result: "value" },
  { name: "last", result: "value" },
  { name: "merge", result: "channel" },
  { name: "randomSample", result: "channel" },
  { name: "set", result: "assign" },
  { name: "splitFasta", result: "channel" },
  { name: "splitFastq", result: "channel" },
  { name: "splitJson", result: "channel" },
  { name: "tap", result: "assign" },
];
