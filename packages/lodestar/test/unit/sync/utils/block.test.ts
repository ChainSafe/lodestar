import {ReqResp} from "../../../../src/network/reqresp/reqResp";
import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {generateEmptySignedBlock} from "../../../utils/block";
import PeerId from "peer-id";
import {testLogger} from "../../../utils/logger";
import {chunkify, getBlockRange, getBlockRangeFromPeer} from "../../../../src/sync/utils";

describe("sync - block utils", function () {
  describe("get block range from multiple peers", function () {
    const sandbox = sinon.createSandbox();

    const logger = testLogger();
    let rpcStub: SinonStubbedInstance<ReqResp>;

    beforeEach(function () {
      sandbox.useFakeTimers();
      rpcStub = sandbox.createStubInstance(ReqResp);
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("happy path", async function () {
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
      const peers = [peer1, peer2];
      rpcStub.beaconBlocksByRange
        .withArgs(sinon.match(peers[0]).or(sinon.match(peers[1])), sinon.match.any)
        .resolves([generateEmptySignedBlock(), generateEmptySignedBlock(), generateEmptySignedBlock()]);
      const blocks = await getBlockRange(logger, rpcStub, peers, {start: 0, end: 4}, 2);
      expect(blocks?.length).to.be.equal(3);
    });

    it("refetch failed chunks", async function () {
      const peer1 = await PeerId.create();
      const peer2 = await PeerId.create();
      const peers = [peer1, peer2];
      rpcStub.beaconBlocksByRange.onFirstCall().rejects(Error("TEST_ERROR"));
      rpcStub.beaconBlocksByRange.onSecondCall().resolves([generateEmptySignedBlock(), generateEmptySignedBlock()]);
      const blockPromise = getBlockRange(logger, rpcStub, peers, {start: 0, end: 4}, 2);
      await sandbox.clock.tickAsync(1000);
      const blocks = await blockPromise;
      expect(blocks?.length).to.be.equal(2);
    });

    it("no chunks", async function () {
      const peer1 = await PeerId.create();
      const peers: PeerId[] = [peer1];
      rpcStub.beaconBlocksByRange.resolves([]);
      const blocks = await getBlockRange(logger, rpcStub, peers, {start: 4, end: 4}, 2);
      expect(blocks?.length).to.be.equal(0);
    });
  });

  describe("Chunkify block range", function () {
    it("should return chunks of block range", function () {
      const result = chunkify(10, 0, 30);
      expect(result.length).to.be.equal(3);
      expect(result[0].start).to.be.equal(0);
      expect(result[0].end).to.be.equal(10);
      expect(result[1].start).to.be.equal(11);
      expect(result[1].end).to.be.equal(21);
      expect(result[2].start).to.be.equal(22);
      expect(result[2].end).to.be.equal(30);
    });

    it("should return chunks of block range - not rounded", function () {
      const result = chunkify(10, 0, 25);
      expect(result.length).to.be.equal(3);
      expect(result[2].start).to.be.equal(22);
      expect(result[2].end).to.be.equal(25);
    });

    it("should produce a one-length chunk", function () {
      const result = chunkify(10, 0, 22);
      expect(result.length).to.be.equal(3);
      expect(result[0].start).to.be.equal(0);
      expect(result[0].end).to.be.equal(10);
      expect(result[1].start).to.be.equal(11);
      expect(result[1].end).to.be.equal(21);
      expect(result[2].start).to.be.equal(22);
      expect(result[2].end).to.be.equal(22);
    });
  });

  describe("get blocks from peer", function () {
    it("should get block range from peer", async function () {
      const rpcStub = sinon.createStubInstance(ReqResp);
      rpcStub.beaconBlocksByRange.withArgs(sinon.match.any, sinon.match.any).resolves([generateEmptySignedBlock()]);
      const result = await getBlockRangeFromPeer(rpcStub, sinon.createStubInstance(PeerId), {start: 1, end: 4});
      if (!result) throw Error("getBlockRangeFromPeer returned null");
      expect(result.length).to.be.greaterThan(0);
      expect(rpcStub.beaconBlocksByRange.calledOnce).to.be.true;
    });
  });
});
