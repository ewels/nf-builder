import { pack } from "../../../packages/lang-2610/src/index";
import type { Model } from "../../../packages/lang-core/src/index";

export const snapshot = (model: Model): string => `${model.name} ${pack.name}`;
