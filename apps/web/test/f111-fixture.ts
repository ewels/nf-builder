// The f111-start-typed oracle case and its entry workflow's projection, for the layout tests (F-207).
import {
  createEngineService,
  installedPackVersions,
  type Projection,
} from "@nf-builder/engine";

const PREFIX = "../../../tools/oracle/cases/f111-start-typed/";
const raw = import.meta.glob<string>(
  "../../../tools/oracle/cases/f111-start-typed/**/*",
  { query: "?raw", import: "default", eager: true },
);
const FIXTURE = Object.entries(raw).map(([path, text]) => ({
  path: path.slice(PREFIX.length),
  text,
}));

export async function entryProjection(): Promise<Projection> {
  const service = createEngineService();
  await service.open({
    version: installedPackVersions()[0] as string,
    files: FIXTURE,
  });
  const result = await service.project("main.nf", null);
  if (!("projection" in result) || result.projection === null)
    throw new Error("no projection");
  return result.projection;
}
