import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/** Where `zig build run:download_spec_tests` extracts every fixture archive. */
export const specFixturesDir = path.join(repoRoot, "test/spec/spec_tests");

// Written by the nightly downloader to point the consensus spec tests at an unreleased
// consensus-specs run. `zig build run:download_spec_tests` removes it.
const nightlyMarkerFile = path.join(specFixturesDir, "nightly.txt");

export type SpecFixtureVersions = {consensus: string; ssz: string; bls: string; interchange: string};

/** Fixture tags pinned under `spec_test_options` in build.zig.zon, shared with the Zig spec tests. */
export function pinnedSpecFixtureVersions(): SpecFixtureVersions {
  const zon = fs.readFileSync(path.join(repoRoot, "build.zig.zon"), "utf8");
  return {
    consensus: zonOptionDefault(zon, "spec_test_version"),
    ssz: zonOptionDefault(zon, "ssz_spec_test_version"),
    bls: zonOptionDefault(zon, "bls_spec_test_version"),
    interchange: zonOptionDefault(zon, "interchange_spec_test_version"),
  };
}

function zonOptionDefault(zon: string, option: string): string {
  const match = zon.match(new RegExp(`\\.${option} = \\.\\{[^}]*\\.default = "([^"]+)"`));
  if (!match) throw new Error(`Option ${option} not found in build.zig.zon`);
  return match[1];
}

/** Consensus fixture version on disk: the last nightly download, else the pinned release. */
export function consensusSpecFixtureVersion(): string {
  if (fs.existsSync(nightlyMarkerFile)) return fs.readFileSync(nightlyMarkerFile, "utf8").trim();
  return pinnedSpecFixtureVersions().consensus;
}

/** Root of the `general`, `minimal` or `mainnet` test tree of a consensus-specs release. */
export function consensusSpecTestsDir(name: string, version = consensusSpecFixtureVersion()): string {
  return path.join(specFixturesDir, version, name, "tests", name);
}
