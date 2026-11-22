import type { PackLints } from "@nf-builder/lang-core";
import { advise } from "./advice.ts";
import { CODES } from "./codes.ts";
import {
  deprecatedChannel,
  deprecatedDirective,
  deprecatedShell,
  deprecatedWhen,
  implicitIt,
} from "./deprecated.ts";
import {
  legacyParams,
  legacyProcess,
  legacyWorkflow,
  paramsOutsideEntry,
  publishDir,
  tupleWhereRecord,
} from "./legacy.ts";
import {
  agentOutput,
  configIncludePlacement,
  duplicateName,
  featureFlag,
  includeAlias,
  pipelineIncludeTypes,
} from "./names.ts";
import {
  missingType,
  publishTypeIgnored,
  typedProcessOutputs,
} from "./typed.ts";

/** The pack's lints (F-112): one lazy chunk, loaded through `LanguagePack.loadLints`. */
export const lints: PackLints = {
  codes: CODES,
  rules: [
    deprecatedWhen,
    deprecatedShell,
    deprecatedChannel,
    implicitIt,
    deprecatedDirective,
    legacyProcess,
    legacyWorkflow,
    legacyParams,
    paramsOutsideEntry,
    tupleWhereRecord,
    publishDir,
    missingType,
    typedProcessOutputs,
    publishTypeIgnored,
    featureFlag,
    pipelineIncludeTypes,
    configIncludePlacement,
    agentOutput,
    includeAlias,
    duplicateName,
  ],
  advise,
  // Type compatibility arrives with the type rules (F-112, LA-32); until then nothing is known to be incompatible.
  connection: () => "unknown",
};
