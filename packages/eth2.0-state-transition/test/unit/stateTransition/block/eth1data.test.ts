import {expect} from "chai";
import sinon from "sinon";
import {serialize} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Eth1Data} from "@chainsafe/eth2.0-types";
import {processEth1Data} from "../../../../src/block/eth1Data";

import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";

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
      config.params.SLOTS_PER_ETH1_VOTING_PERIOD * 2
    ).fill(undefined).map(() => {
      return vote;
    });
    const block = generateEmptyBlock();
    block.body.eth1Data = vote;
    processEth1Data(config, state, block.body);
    expect(serialize(config.types.Eth1Data, state.eth1Data).toString('hex'))
      .to.be.equal(serialize(config.types.Eth1Data, vote).toString('hex'));
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
    processEth1Data(config, state, block.body);
    expect(serialize(config.types.Eth1Data, state.eth1Data).toString('hex'))
      .to.not.be.equal(serialize(config.types.Eth1Data, vote).toString('hex'));
  });
});
