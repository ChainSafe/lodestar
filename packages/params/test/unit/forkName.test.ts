import {describe, expect, it} from "vitest";
import {
  ForkName,
  forkAll,
  forkPostAltair,
  forkPostBellatrix,
  forkPostCapella,
  forkPostDeneb,
  highestFork,
  lowestFork,
} from "../../src/forkName.js";

describe("forkName", () => {
  it("should have valid allForks", () => {
    expect(forkAll).toMatchSnapshot();
  });

  it("should have valid post-altair forks", () => {
    expect(forkPostAltair).toMatchSnapshot();
  });

  it("should have valid post-bellatrix forks", () => {
    expect(forkPostBellatrix).toMatchSnapshot();
  });

  it("should have valid post-capella forks", () => {
    expect(forkPostCapella).toMatchSnapshot();
  });

  it("should have valid post-deneb forks", () => {
    expect(forkPostDeneb).toMatchSnapshot();
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
