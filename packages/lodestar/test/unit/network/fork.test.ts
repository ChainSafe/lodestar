import {expect} from "chai";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBeaconConfig, IForkInfo} from "@chainsafe/lodestar-config";
import {getCurrentAndNextFork} from "../../../src/network/forks";

describe("network / fork", () => {
  const forks: Record<ForkName, IForkInfo> = {
    phase0: {
      name: ForkName.phase0,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 0]),
    },
    altair: {
      name: ForkName.altair,
      epoch: 0,
      version: Buffer.from([0, 0, 0, 1]),
    },
  };
  const altairEpoch0 = {forks} as IBeaconConfig;
  it("should return altair on epoch -1", () => {
    expect(getCurrentAndNextFork(altairEpoch0, -1)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: undefined,
    });
  });
  it("should return altair on epoch 0", () => {
    expect(getCurrentAndNextFork(altairEpoch0, 0)).to.deep.equal({
      currentFork: forks[ForkName.altair],
      nextFork: undefined,
    });
  });
});
