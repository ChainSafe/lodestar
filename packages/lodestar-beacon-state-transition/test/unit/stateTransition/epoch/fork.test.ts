import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState} from "@chainsafe/lodestar-types";
import {generateState} from "../../../utils/state";
import {processForkChanged} from "../../../../src/epoch/fork";
import {expect} from "chai";
import {bytesToInt} from "@chainsafe/lodestar-utils";

describe("processForkChanged", () => {
  let state: BeaconState;

  beforeEach(() => {
    state = generateState();
    state.fork = {
      currentVersion: Buffer.from([1, 0, 0, 0]),
      epoch: 100,
      previousVersion: Buffer.alloc(4),
    };
  });

  afterEach(() => {
    config.params.ALL_FORKS = [];
  });

  it("should not update fork if no matched next fork", () => {
    config.params.ALL_FORKS = [];
    const preFork = state.fork;
    processForkChanged(config, state);
    expect(config.types.Fork.equals(preFork, state.fork)).to.be.true;
  });

  it("should not update fork if found matched next fork but epoch not matched", () => {
    config.params.ALL_FORKS = [
      {
        previousVersion: bytesToInt(Buffer.from([1, 0, 0, 0])),
        currentVersion: bytesToInt(Buffer.from([2, 0, 0, 0])),
        epoch: 200,
      },
    ];
    const preFork = state.fork;
    processForkChanged(config, state);
    expect(config.types.Fork.equals(preFork, state.fork)).to.be.true;
  });

  it("should update fork if found matched next fork and matched epoch", () => {
    config.params.ALL_FORKS = [
      {
        previousVersion: bytesToInt(Buffer.from([1, 0, 0, 0])),
        currentVersion: bytesToInt(Buffer.from([2, 0, 0, 0])),
        epoch: 200,
      },
    ];
    const preFork = state.fork;
    state.slot = 200 * config.params.SLOTS_PER_EPOCH - 1;
    processForkChanged(config, state);
    expect(config.types.Fork.equals(preFork, state.fork)).to.be.false;
    expect(config.types.Version.equals(preFork.currentVersion, state.fork.previousVersion));
    expect(state.fork.epoch).to.be.equal(200);
  });
});