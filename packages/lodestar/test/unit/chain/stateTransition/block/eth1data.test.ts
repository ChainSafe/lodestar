import {expect} from "chai";
import sinon from "sinon";
import {serialize} from "@chainsafe/ssz";
import {Eth1Data} from "@chainsafe/eth2-types";
import {processEth1Data} from "../../../../../src/chain/stateTransition/block/eth1Data";

import {generateEmptyBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe('process block - eth1data', function () {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);

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
    expect(serialize(state.latestEth1Data, config.types.Eth1Data).toString('hex'))
      .to.be.equal(serialize(vote, config.types.Eth1Data).toString('hex'));
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
    expect(serialize(state.latestEth1Data, config.types.Eth1Data).toString('hex'))
      .to.not.be.equal(serialize(vote, config.types.Eth1Data).toString('hex'));
  });
});
