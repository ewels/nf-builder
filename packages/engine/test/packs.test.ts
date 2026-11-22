import { pack } from "@nf-builder/lang-2610";
import { describe, expect, it } from "vitest";
import { installedPacks, installedPackVersions } from "../src/packs";

describe("installed packs", () => {
  it("F-113 F-201: installedPackVersions equals the installed packs' versions", () => {
    expect(installedPackVersions()).toEqual(
      installedPacks.map((p) => p.version),
    );
  });

  it("UX-01 LA-02: installedPackVersions lists the version of each installed pack, taken from the pack", () => {
    const versions = installedPackVersions();
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toEqual(installedPacks.map((p) => p.version));
    expect(versions).toEqual([pack.version]);
  });
});
