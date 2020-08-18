import {expect} from "chai";
import sinon from "sinon";

import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Eth1Data} from "@chainsafe/lodestar-types";
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
      config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * 2 * config.params.SLOTS_PER_EPOCH
    ).fill(undefined).map(() => {
      return vote;
    }) as List<Eth1Data>;
    const block = generateEmptyBlock();
    block.body.eth1Data = vote;
    processEth1Data(config, state, block.body);
    expect(config.types.Eth1Data.serialize(state.eth1Data))
      .to.be.deep.equal(config.types.Eth1Data.serialize(vote));
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
    expect(config.types.Eth1Data.serialize(state.eth1Data))
      .to.not.be.deep.equal(config.types.Eth1Data.serialize(vote));
  });
});
