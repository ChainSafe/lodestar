import {expect} from "chai";
import sinon from "sinon";

import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0} from "@chainsafe/lodestar-types";
import {processEth1Data} from "../../../../src/phase0/naive/block/eth1Data";

import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {BeaconState} from "@chainsafe/lodestar-types/phase0";
import {BeaconBlock} from "@chainsafe/lodestar-types/phase0";

describe("process block - eth1data", function () {
  let state: BeaconState, vote: phase0.Eth1Data, block: BeaconBlock;
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  beforeEach(function () {
    state = generateState();
    vote = {
      depositCount: 3,
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
    };
    block = generateEmptyBlock();
    block.body.eth1Data = vote;
  });

  it("should set latest eth1 data", function () {
    state.eth1DataVotes = new Array(config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * 2 * config.params.SLOTS_PER_EPOCH)
      .fill(undefined)
      .map(() => {
        return vote;
      }) as List<phase0.Eth1Data>;
    processEth1Data(config, state, block.body);
    expect(config.types.phase0.Eth1Data.serialize(state.eth1Data)).to.be.deep.equal(
      config.types.phase0.Eth1Data.serialize(vote)
    );
  });

  it("should not set latest eth1 data", function () {
    processEth1Data(config, state, block.body);
    expect(config.types.phase0.Eth1Data.serialize(state.eth1Data)).to.not.be.deep.equal(
      config.types.phase0.Eth1Data.serialize(vote)
    );
  });
});
