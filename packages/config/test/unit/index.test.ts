import {expect} from "chai";
import {ForkName} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {config, chainConfig} from "../../src/default.js";
import {createForkConfig} from "../../src/index.js";

describe("forks", () => {
  it("Forks should be in ascending order", () => {
    const forks = Object.values(config.forks);
    for (let i = 0; i < forks.length - 1; i++) {
      const fork1 = forks[i];
      const fork2 = forks[i + 1];

      // Use less equal to be okay with both forks being at Infinity
      expect(fork1.epoch).to.be.at.most(
        fork2.epoch,
        `Forks are not sorted ${fork1.name} ${fork1.epoch} -> ${fork2.name} ${fork2.epoch}`
      );
    }
  });

  it("Get phase0 fork for slot 0", () => {
    const fork = config.getForkName(0);
    expect(fork).to.equal(ForkName.phase0);
  });

  it("correct prev data", () => {
    for (let i = 1; i < config.forksAscendingEpochOrder.length; i++) {
      const fork = config.forksAscendingEpochOrder[i];
      const prevFork = config.forksAscendingEpochOrder[i - 1];
      expect(toHexString(fork.prevVersion)).to.equal(toHexString(prevFork.version), `Wrong prevVersion ${fork.name}`);
      expect(fork.prevForkName).to.equal(prevFork.name, `Wrong prevName ${fork.name}`);
    }
  });

  it("correctly handle pre-genesis", () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const postMergeTestnet = createForkConfig({...chainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0});
    expect(postMergeTestnet.getForkName(-1)).to.equal(ForkName.bellatrix);
  });
});
