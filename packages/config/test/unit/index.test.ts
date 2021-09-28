import {ForkName} from "@chainsafe/lodestar-params";
import {expect} from "chai";
import {config} from "../../src/default";

describe("forks", () => {
  it("Forks should be in ascending order", () => {
    const forks = Object.values(config.forks);
    for (let i = 0; i < forks.length - 1; i++) {
      const fork1 = forks[i];
      const fork2 = forks[i + 1];

      // Use less equal to be okay with both forks being at Infinity
      expect(fork1.epoch <= fork2.epoch).to.be.equal(
        true,
        `Forks are not sorted ${fork1.name} ${fork1.epoch} -> ${fork2.name} ${fork2.epoch}`
      );
    }
  });

  it("Get phase0 fork for slot 0", () => {
    const fork = config.getForkName(0);
    expect(fork).to.equal(ForkName.phase0);
  });
});
