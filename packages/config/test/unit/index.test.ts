import {describe, it, expect} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {config, chainConfig} from "../../src/default.js";
import {createForkConfig} from "../../src/index.js";

describe("forks", () => {
  it("Forks should be in ascending order", () => {
    const forks = Object.values(config.forks);
    for (let i = 0; i < forks.length - 1; i++) {
      const fork1 = forks[i];
      const fork2 = forks[i + 1];

      // Use less equal to be okay with both forks being at Infinity
      expect(fork1.epoch).toBeLessThanOrEqual(fork2.epoch);
    }
  });

  it("Get phase0 fork for slot 0", () => {
    const fork = config.getForkName(0);
    expect(fork).toBe(ForkName.phase0);
  });

  it("correct prev data", () => {
    for (let i = 1; i < config.forksAscendingEpochOrder.length; i++) {
      const fork = config.forksAscendingEpochOrder[i];
      const prevFork = config.forksAscendingEpochOrder[i - 1];
      expect(toHexString(fork.prevVersion)).toBe(toHexString(prevFork.version));
      expect(fork.prevForkName).toBe(prevFork.name);
    }
  });

  it("correctly handle pre-genesis", () => {
    const postMergeTestnet = createForkConfig({...chainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0});
    expect(postMergeTestnet.getForkName(-1)).toBe(ForkName.bellatrix);
  });
});
