/** A language pack (ADR 0006). M1 features grow this towards the architecture.md sketch. */
export interface LanguagePack {
  readonly version: string;
}
export type {
  CatalogueEntry,
  CatalogueSource,
  ConfigCatalogue,
  ConfigNode,
  FeatureFlagEntry,
  NamedGroup,
  OperatorEntry,
  Parameter,
  ScriptCatalogue,
  Signature,
} from "./catalogue.ts";
