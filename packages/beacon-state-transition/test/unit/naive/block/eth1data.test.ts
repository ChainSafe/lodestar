import {expect} from "chai";
import sinon from "sinon";

import {List} from "@chainsafe/ssz";
import {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {processEth1Data} from "../../../../src/naive/phase0/block/eth1Data";

import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";

describe("process block - eth1data", function () {
  let state: phase0.BeaconState, vote: phase0.Eth1Data, block: phase0.BeaconBlock;
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
    state.eth1DataVotes = new Array(EPOCHS_PER_ETH1_VOTING_PERIOD * 2 * SLOTS_PER_EPOCH).fill(undefined).map(() => {
      return vote;
    }) as List<phase0.Eth1Data>;
    processEth1Data(state, block.body);
    expect(ssz.phase0.Eth1Data.serialize(state.eth1Data)).to.be.deep.equal(ssz.phase0.Eth1Data.serialize(vote));
  });

  it("should not set latest eth1 data", function () {
    processEth1Data(state, block.body);
    expect(ssz.phase0.Eth1Data.serialize(state.eth1Data)).to.not.be.deep.equal(ssz.phase0.Eth1Data.serialize(vote));
  });
});
