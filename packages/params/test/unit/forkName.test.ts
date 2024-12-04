import {describe, expect, it} from "vitest";
import {
  ForkName,
  forkAll,
  forkBlobs,
  forkExecution,
  forkLightClient,
  forkWithdrawals,
  highestFork,
  lowestFork,
} from "../../src/forkName.js";

describe("forkName", () => {
  it("should have valid allForks", () => {
    expect(forkAll).toMatchSnapshot();
  });

  it("should have valid execution forks", () => {
    expect(forkExecution).toMatchSnapshot();
  });

  it("should have valid lightclient forks", () => {
    expect(forkLightClient).toMatchSnapshot();
  });

  it("should have valid withdrawal forks", () => {
    expect(forkWithdrawals).toMatchSnapshot();
  });

  it("should have valid blobs forks", () => {
    expect(forkBlobs).toMatchSnapshot();
  });

  describe("highestFork", () => {
    it("should return the only fork as highest", () => {
      expect(highestFork([ForkName.altair])).toBe(ForkName.altair);
    });

    it("should return the the highest fork", () => {
      expect(highestFork([ForkName.altair, ForkName.bellatrix])).toBe(ForkName.bellatrix);
    });

    it("should return the the highest fork if given in random order", () => {
      expect(highestFork([ForkName.altair, ForkName.bellatrix, ForkName.deneb, ForkName.phase0])).toBe(ForkName.deneb);
    });
  });

  describe("lowestFork", () => {
    it("should return the only fork as lowest", () => {
      expect(lowestFork([ForkName.altair])).toBe(ForkName.altair);
    });

    it("should return the the lowest fork", () => {
      expect(lowestFork([ForkName.altair, ForkName.bellatrix])).toBe(ForkName.altair);
    });

    it("should return the the lowest fork if given in random order", () => {
      expect(lowestFork([ForkName.altair, ForkName.bellatrix, ForkName.deneb, ForkName.phase0])).toBe(ForkName.phase0);
    });
  });
});
