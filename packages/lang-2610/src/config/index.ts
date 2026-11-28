// The config editor's rules over the config catalogue (F-601): one object the view, the commands and the lint share.
import type { ConfigCatalogue, ConfigRules } from "@nf-builder/lang-core";
import { configDocsUrl } from "./docs.ts";
import { CONFIG_FORMS, valueKindOf } from "./forms.ts";
import { classifyPath } from "./validator.ts";

export function createConfigRules(catalogue: ConfigCatalogue): ConfigRules {
  return {
    forms: CONFIG_FORMS,
    classify: (names) => classifyPath(catalogue, names),
    valueKind: valueKindOf,
    docsUrl: (names) => configDocsUrl(catalogue, names),
  };
}
