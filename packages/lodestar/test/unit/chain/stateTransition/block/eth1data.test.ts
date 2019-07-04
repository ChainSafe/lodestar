import {expect} from "chai";
import sinon from "sinon";
import {serialize} from "@chainsafe/ssz";

import {Eth1Data} from "../../../../../../types";
import {SLOTS_PER_ETH1_VOTING_PERIOD} from "../../../../../constants";
import {processEth1Data} from "../../../../../chain/stateTransition/block/eth1Data";

import {generateEmptyBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";

describe('process block - eth1data', function () {

  const sandbox = sinon.createSandbox();

  beforeEach(() => {
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should set latest eth1 data', function () {
    const state = generateState();
    const vote: Eth1Data = {
      depositCount: 3,
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
    };
    state.eth1DataVotes = new Array(
      SLOTS_PER_ETH1_VOTING_PERIOD * 2
    ).fill(undefined).map(() => {
      return vote;
    });
    const block = generateEmptyBlock();
    block.body.eth1Data = vote;
    processEth1Data(state, block.body);
    expect(serialize(state.latestEth1Data, Eth1Data).toString('hex'))
      .to.be.equal(serialize(vote, Eth1Data).toString('hex'));
  });

  it('should not set latest eth1 data', function () {
    const state = generateState();
    const vote: Eth1Data = {
      depositCount: 3,
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
    };
    const block = generateEmptyBlock();
    block.body.eth1Data = vote;
    processEth1Data(state, block.body);
    expect(serialize(state.latestEth1Data, Eth1Data).toString('hex'))
      .to.not.be.equal(serialize(vote, Eth1Data).toString('hex'));
  });
});
