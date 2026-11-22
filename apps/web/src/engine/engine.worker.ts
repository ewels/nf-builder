import { createEngineService } from "@nf-builder/engine";
import type { Endpoint } from "comlink";
import { exposeEngine } from "./expose";

// the DOM lib types `self` as a Window; in a dedicated worker it is the worker scope, which is an Endpoint
exposeEngine(createEngineService(), self as unknown as Endpoint);
