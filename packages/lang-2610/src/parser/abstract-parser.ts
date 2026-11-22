// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/parser/AbstractParser.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE).
// Upstream only adds Groovy's error-position hooks, which nothing here uses, so this class adds nothing.
import { Parser } from "antlr4ng";

export abstract class AbstractParser extends Parser {}
