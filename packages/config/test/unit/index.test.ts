import {expect} from "chai";
import {ForkName} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {chainConfig as mainnetPreset} from "../../src/chainConfig/presets/mainnet.js";
import {chainConfig as minimalPreset} from "../../src/chainConfig/presets/minimal.js";
import {config} from "../../src/default.js";

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

  it("Must no schedule forks in the presets", () => {
    // Every testnet extends the mainnet preset. If a fork is scheduled in the mainnet preset but not overridden
    // in the testnet config, the testnet nodes may unexpectedly fork.
    for (const preset of [mainnetPreset, minimalPreset]) {
      for (const [key, value] of Object.entries(preset)) {
        if (key.endsWith("FORK_EPOCH") && value !== Infinity) {
          throw Error(`${key} must be Infinity but is ${value}`);
        }
      }
    }
  });
});
