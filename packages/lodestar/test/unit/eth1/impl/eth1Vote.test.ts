/* eslint-disable @typescript-eslint/no-object-literal-type-assertion */
import {EthersEth1Notifier, IEth1Notifier} from "../../../../src/eth1";
import sinon, {SinonStubbedInstance} from "sinon";
import {beforeEach, describe, it} from "mocha";
import {getEth1Vote} from "../../../../src/eth1/impl/eth1Vote";
import {generateState} from "../../../utils/state";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {Block} from "ethers/providers";
import {Eth1Data} from "@chainsafe/eth2.0-types";
import {equals} from "@chainsafe/ssz";
import {expect} from "chai";

describe("et1h vote", function () {

  const sandbox = sinon.createSandbox();

  let eth1Notifier: SinonStubbedInstance<IEth1Notifier>;

  beforeEach(function () {
    eth1Notifier = sandbox.createStubInstance(EthersEth1Notifier);
  });

  it("get eth1 vote - happy path", async function () {
    config.params.ETH1_FOLLOW_DISTANCE = 3;
    eth1Notifier.getHead.resolves({

    } as Block);
    const expectedVote: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    eth1Notifier.getEth1Data.onFirstCall().resolves(expectedVote);
    eth1Notifier.getEth1Data.resolves({
      blockHash: Buffer.alloc(32, 1),
      depositRoot: Buffer.alloc(32, 1),
      depositCount: 12
    });
    const eth1Vote = await getEth1Vote.bind(eth1Notifier)(
      config,
      generateState({slot: 5, eth1DataVotes: [expectedVote]}),
      5
    );
    expect(eth1Notifier.getEth1Data.callCount).to.be.equal(2);
    expect(equals(eth1Vote, expectedVote, config.types.Eth1Data)).to.be.true;
  });

  it("get eth1 vote - longer period tail", async function () {
    config.params.ETH1_FOLLOW_DISTANCE = 3;
    eth1Notifier.getHead.resolves({

    } as Block);
    const expectedVote: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    eth1Notifier.getEth1Data.onThirdCall().resolves(expectedVote);
    eth1Notifier.getEth1Data.resolves({
      blockHash: Buffer.alloc(32, 1),
      depositRoot: Buffer.alloc(32, 1),
      depositCount: 12
    });
    const eth1Vote = await getEth1Vote.bind(eth1Notifier)(
      config,
      generateState({slot: 3, eth1DataVotes: [expectedVote]}),
      5
    );
    expect(eth1Notifier.getEth1Data.callCount).to.be.equal(5);
    expect(equals(eth1Vote, expectedVote, config.types.Eth1Data)).to.be.true;
  });

  it("get eth1 vote - tiebreak", async function () {
    config.params.ETH1_FOLLOW_DISTANCE = 3;
    eth1Notifier.getHead.resolves({

    } as Block);
    const expectedVote1: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    const expectedVote2: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 12
    };
    eth1Notifier.getEth1Data.onFirstCall().resolves(expectedVote2);
    eth1Notifier.getEth1Data.onSecondCall().resolves(expectedVote1);
    eth1Notifier.getEth1Data.resolves({
      blockHash: Buffer.alloc(32, 1),
      depositRoot: Buffer.alloc(32, 1),
      depositCount: 12
    });
    const eth1Vote = await getEth1Vote.bind(eth1Notifier)(
      config,
      generateState({slot: 5, eth1DataVotes: [expectedVote2, expectedVote1]}),
      5
    );
    expect(eth1Notifier.getEth1Data.callCount).to.be.equal(2);
    expect(equals(eth1Vote, expectedVote1, config.types.Eth1Data)).to.be.true;
  });

  it("get eth1 vote - no valid votes", async function () {
    config.params.ETH1_FOLLOW_DISTANCE = 3;
    eth1Notifier.getHead.resolves({

    } as Block);
    const expectedVote: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    eth1Notifier.getEth1Data.resolves(expectedVote);
    const eth1Vote = await getEth1Vote.bind(eth1Notifier)(
      config,
      generateState({slot: 5, eth1DataVotes: []}),
      5
    );
    expect(eth1Notifier.getEth1Data.callCount).to.be.equal(3);
    expect(equals(eth1Vote, expectedVote, config.types.Eth1Data)).to.be.true;
  });


});