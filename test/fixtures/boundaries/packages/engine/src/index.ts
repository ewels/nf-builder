import { pack } from "../../lang-2610/src/index";
import type { Model } from "../../lang-core/src/index";

export const engine = (model: Model): string => `${model.name} ${pack.name}`;
