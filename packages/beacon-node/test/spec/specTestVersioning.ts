import path from "node:path";
import {
  consensusSpecFixtureVersion,
  consensusSpecTestsDir,
  pinnedSpecFixtureVersions,
  specFixturesDir,
} from "@lodestar/spec-test-util/fixtures";

const pinned = pinnedSpecFixtureVersions();
const consensusVersion = consensusSpecFixtureVersion();

export const ethereumConsensusSpecsTests = {
  specVersion: consensusVersion,
  testsDir: (name: string): string => consensusSpecTestsDir(name, consensusVersion),
};

export const sszSpecTests = {
  fixturesDir: path.join(specFixturesDir, "ssz", pinned.ssz, "fixtures", "ssz", "ssz"),
};

export const blsSpecTests = {
  outputDir: path.join(specFixturesDir, "bls", pinned.bls),
};

// Comptests ship with the consensus-specs release but download separately, so they stay on the pin.
export const comptestsSpecTests = {
  testsDir: (preset: string): string => path.join(specFixturesDir, pinned.consensus, "comptests", "tests", preset),
};
