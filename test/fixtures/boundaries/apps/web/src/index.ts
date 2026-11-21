import { engine } from "../../../packages/engine/src/index";
import type { Model } from "../../../packages/lang-core/src/index";
import { source } from "../../../packages/sources/src/index";

const model: Model = { name: "web" };
export const label = `${engine(model)} ${source(model)}`;
