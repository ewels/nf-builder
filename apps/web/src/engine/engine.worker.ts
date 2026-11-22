import { createEngineService } from "@nf-builder/engine";
import type { Endpoint } from "comlink";
import { openProjectDb } from "../workspace/project-db";
import { createWorkspace } from "../workspace/workspace";
import { exposeEngine } from "./expose";

// the DOM lib types `self` as a Window; in a dedicated worker it is the worker scope, which is an Endpoint
exposeEngine(
  createWorkspace({
    engine: createEngineService(),
    openDb: (onClosed) => openProjectDb(indexedDB, onClosed),
  }),
  self as unknown as Endpoint,
);
