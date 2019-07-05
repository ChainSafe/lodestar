import {generateEth1Data} from "../../../../utils/eth1Data";
import sinon from "sinon";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import {bestVoteData, filterValidVotes} from "../../../../../src/chain/factory/block/eth1Data";
import {expect} from "chai";
import {ETH1_FOLLOW_DISTANCE, ZERO_HASH} from "@chainsafe/eth2-types";
import {Block} from "ethers/providers";
import {generateState} from "../../../../utils/state";
import {Eth1Data} from "@chainsafe/eth2-types";

describe('blockAssembly - eth1 data', function() {

  const sandbox = sinon.createSandbox();

  let eth1Stub;

  beforeEach(() => {
    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('filter votes', function () {

    it('should filter non cannonical vote', async function () {
      eth1Stub.getBlock.returns(null);
      const votes = [generateEth1Data()];
      const valid = await filterValidVotes(votes, eth1Stub, null, null);
      expect(valid.length).to.be.equal(0);
    });

    it('should filter too young vote', async function () {
      eth1Stub.getBlock.returns({number: 0});
      const votes = [generateEth1Data(ZERO_HASH)];
      const valid = await filterValidVotes(votes, eth1Stub, {number: ETH1_FOLLOW_DISTANCE - 1} as Block, null);
      expect(valid.length).to.be.equal(0);
    });

    it('should filter vote older than state', async function () {
      eth1Stub.getBlock.returns({number: 0});
      const votes = [generateEth1Data(ZERO_HASH)];
      const valid = await filterValidVotes(votes, eth1Stub, {number: ETH1_FOLLOW_DISTANCE} as Block, {number: 1} as Block);
      expect(valid.length).to.be.equal(0);
    });

    it('should filter vote because malformed deposit count', async function () {
      eth1Stub.getBlock.returns({number: 2});
      eth1Stub.depositCount.returns(1);
      eth1Stub.depositRoot.returns(ZERO_HASH);
      const votes = [generateEth1Data(ZERO_HASH)];
      const valid = await filterValidVotes(votes, eth1Stub, {number: ETH1_FOLLOW_DISTANCE + 2} as Block, {number: 1} as Block);
      expect(valid.length).to.be.equal(0);
      expect(eth1Stub.depositCount.calledOnce).to.be.true;
      expect(eth1Stub.depositRoot.calledOnce).to.be.true;
    });

    it('should filter vote because malformed deposit root', async function () {
      eth1Stub.getBlock.returns({number: 2});
      eth1Stub.depositCount.returns(0);
      eth1Stub.depositRoot.returns(Buffer.alloc(32, 1));
      const votes = [generateEth1Data(ZERO_HASH)];
      const valid = await filterValidVotes(votes, eth1Stub, {number: ETH1_FOLLOW_DISTANCE + 2} as Block, {number: 1} as Block);
      expect(valid.length).to.be.equal(0);
      expect(eth1Stub.depositCount.calledOnce).to.be.true;
      expect(eth1Stub.depositRoot.calledOnce).to.be.true;
    });

    it('should not filter valid vote', async function () {
      eth1Stub.getBlock.returns({number: 2});
      eth1Stub.depositCount.returns(0);
      eth1Stub.depositRoot.returns(ZERO_HASH);
      const votes = [generateEth1Data(ZERO_HASH)];
      const valid = await filterValidVotes(votes, eth1Stub, {number: ETH1_FOLLOW_DISTANCE + 2} as Block, {number: 1} as Block);
      expect(valid.length).to.be.equal(1);
      expect(eth1Stub.depositCount.calledOnce).to.be.true;
      expect(eth1Stub.depositRoot.calledOnce).to.be.true;
    });

  });

  describe('best vote', function () {

    it('no valid votes', async function () {
      eth1Stub.getBlock.returns({number: 0});
      const hash = Buffer.alloc(32, 4).toString('hex');
      eth1Stub.getBlock.withArgs(1).returns({
        hash
      });
      eth1Stub.depositRoot.withArgs(hash).returns(Buffer.alloc(32, 1));
      eth1Stub.depositCount.withArgs(hash).returns(2);
      eth1Stub.getHead.returns({number: ETH1_FOLLOW_DISTANCE + 1});
      const bestVote = await bestVoteData(generateState({eth1DataVotes: [generateEth1Data()]}), eth1Stub);
      expect(bestVote.blockHash).to.be.deep.equal(Buffer.from(hash.slice(2), 'hex'));
      expect(bestVote.depositCount).to.be.deep.equal(2);
      expect(bestVote.depositRoot).to.be.deep.equal(Buffer.alloc(32, 1));
    });

    it('single most frequent valid vote', async function () {
      eth1Stub.getHead.returns({number: ETH1_FOLLOW_DISTANCE + 2});
      //latest eth block
      eth1Stub.getBlock.withArgs('0x' + Buffer.alloc(32, 9).toString('hex')).returns({number: 1});
      eth1Stub.getBlock.returns({number: 2});
      eth1Stub.depositCount.returns(0);
      eth1Stub.depositRoot.returns(ZERO_HASH);

      const votes = [
        generateEth1Data(ZERO_HASH),
        generateEth1Data(ZERO_HASH),
        generateEth1Data(Buffer.alloc(32, 1))
      ];
      const bestVote = await bestVoteData(
        generateState({
          eth1DataVotes: votes,
          latestEth1Data: {blockHash: Buffer.alloc(32, 9)} as Eth1Data}
        ),
        eth1Stub
      );
      expect(bestVote).to.be.deep.equal(generateEth1Data(ZERO_HASH));
    });

    it('multiple tied most frequent valid vote', async function () {
      eth1Stub.getHead.returns({number: ETH1_FOLLOW_DISTANCE + 2});
      //latest eth block
      eth1Stub.getBlock.withArgs('0x' + Buffer.alloc(32, 9).toString('hex')).resolves({number: 1});
      eth1Stub.getBlock.resolves({number: 2});
      eth1Stub.depositCount.returns(0);
      eth1Stub.depositRoot.returns(ZERO_HASH);

      const votes = [
        generateEth1Data(ZERO_HASH),
        generateEth1Data(ZERO_HASH),
        generateEth1Data(Buffer.alloc(32, 1)),
        generateEth1Data(Buffer.alloc(32, 1))
      ];
      const bestVote = await bestVoteData(
        generateState({
          eth1DataVotes: votes,
          latestEth1Data: {blockHash: Buffer.alloc(32, 9)} as Eth1Data}
        ),
        eth1Stub
      );
      expect(bestVote).to.be.deep.equal(generateEth1Data(ZERO_HASH));
    });

  });

});
