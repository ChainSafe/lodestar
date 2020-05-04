import sinon from "sinon";
import {beforeEach, describe, it} from "mocha";
import {getEth1Vote} from "../../../../../src/chain/factory/block/eth1Vote";
import {generateState} from "../../../../utils/state";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Block} from "ethers/providers";
import {Eth1Data} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {StubbedBeaconDb} from "../../../../utils/stub";

describe("eth1 vote", function () {

  const sandbox = sinon.createSandbox();
  let db: StubbedBeaconDb;

  beforeEach(function () {
    db = new StubbedBeaconDb(sandbox);
  });

  it("get eth1 vote - happy path", async function () {
    const expectedVote: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    db.eth1Data.values.resolves([expectedVote]);
    const eth1Vote = await getEth1Vote(
      config,
      db,
      generateState({slot: 5, eth1DataVotes: [expectedVote]}),
    );
    expect(db.eth1Data.values.callCount).to.be.equal(1);
    expect(config.types.Eth1Data.equals(eth1Vote, expectedVote)).to.be.true;
  });

  it("get eth1 vote - default vote", async function () {
    const expectedVote: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    db.eth1Data.values.resolves([expectedVote]);
    const eth1Vote = await getEth1Vote(
      config,
      db,
      generateState({slot: 3, eth1DataVotes: [{
        blockHash: Buffer.alloc(32, 1),
        depositRoot: Buffer.alloc(32, 1),
        depositCount: 12
      }]}),
    );
    expect(db.eth1Data.values.callCount).to.be.equal(1);
    expect(config.types.Eth1Data.equals(eth1Vote, expectedVote)).to.be.true;
  });

  it("get eth1 vote - tiebreak", async function () {
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
    db.eth1Data.values.resolves([expectedVote2, expectedVote1]);
    const eth1Vote = await getEth1Vote(
      config,
      db,
      generateState({slot: 5, eth1DataVotes: [expectedVote2, expectedVote1]}),
    );
    expect(db.eth1Data.values.callCount).to.be.equal(1);
    expect(config.types.Eth1Data.equals(eth1Vote, expectedVote1)).to.be.true;
  });

  it("get eth1 vote - no vote in state", async function () {
    const expectedVote: Eth1Data = {
      blockHash: Buffer.alloc(32),
      depositRoot: Buffer.alloc(32),
      depositCount: 10
    };
    db.eth1Data.values.resolves([expectedVote]);
    const eth1Vote = await getEth1Vote(
      config,
      db,
      generateState({slot: 5, eth1DataVotes: []}),
    );
    expect(db.eth1Data.values.callCount).to.be.equal(1);
    expect(config.types.Eth1Data.equals(eth1Vote, expectedVote)).to.be.true;
  });

});
