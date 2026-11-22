import { expect, test } from "@playwright/test";

type Index = {
  format: number;
  modules: { name: string; version: string; typed: boolean | null }[];
};

test("F-501 step 1 IO-31: the built site serves the snapshot at /registry/ as JSON", async ({
  request,
}) => {
  const indexResponse = await request.get("/registry/index.json");
  expect(indexResponse.status()).toBe(200);
  // The SPA fallback answers a missing file with HTML and status 200, so the type matters.
  expect(indexResponse.headers()["content-type"]).toContain("json");
  const index = (await indexResponse.json()) as Index;
  expect(index.format).toBe(1);
  const fastqc = index.modules.find((m) => m.name === "nf-core/fastqc");
  expect(fastqc).toMatchObject({ typed: false });

  const ports = await request.get("/registry/ports.json");
  expect(ports.headers()["content-type"]).toContain("json");
  expect(Object.keys((await ports.json()).modules)).toContain("nf-core/fastqc");

  const bundle = await request.get(
    `/registry/modules/nf-core/fastqc/${fastqc?.version}.json`,
  );
  expect(bundle.headers()["content-type"]).toContain("json");
  const files = ((await bundle.json()) as { files: { path: string }[] }).files;
  expect(files.map((f) => f.path)).toContain("main.nf");
});
