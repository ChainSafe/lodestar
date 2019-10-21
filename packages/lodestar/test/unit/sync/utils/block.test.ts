import {beforeEach, afterEach, describe, it} from "mocha";
import {ReqResp} from "../../../../src/network/reqResp";
import sinon from "sinon";
import {ReputationStore} from "../../../../src/sync/IReputation";
import * as syncUtils from "../../../../src/sync/utils/sync";
import {getBlockRange} from "../../../../src/sync/utils/blocks";
// @ts-ignore
import PeerInfo from "peer-info";
import {expect} from "chai";
import {generateEmptyBlock} from "../../../utils/block";

describe("sync - block utils", function () {

  describe("get block range from multiple peers", function () {

    const sandbox = sinon.createSandbox();

    let repsStub: any, rpcStub: any, getBlockRangeFromPeerStub: any;

    beforeEach(function () {
      repsStub = sandbox.createStubInstance(ReputationStore);
      rpcStub = sandbox.createStubInstance(ReqResp);
      getBlockRangeFromPeerStub = sandbox.stub(syncUtils, "getBlockRangeFromPeer");
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("happy path", async function () {
      const peer1 = {id: 1} as unknown as PeerInfo;
      const peer2 = {id: 2} as unknown as PeerInfo;
      const peers = [peer1, peer2];
      getBlockRangeFromPeerStub
        .withArgs(sinon.match.any, sinon.match.any, peer1, sinon.match.any)
        .resolves([generateEmptyBlock()]);
      getBlockRangeFromPeerStub
        .withArgs(sinon.match.any, sinon.match.any, peer2, sinon.match.any)
        .resolves([generateEmptyBlock(), generateEmptyBlock()]);
      const blocks = await getBlockRange(rpcStub, repsStub, peers, {start: 0, end: 4}, 2);
      expect(blocks.length).to.be.equal(3);
    });

    it("refetch failed chunks", async function () {
      const peer1 = {id: 1} as unknown as PeerInfo;
      const peer2 = {id: 2} as unknown as PeerInfo;
      const peers = [peer1, peer2];
      getBlockRangeFromPeerStub
        .withArgs(sinon.match.any, sinon.match.any, peer1, sinon.match.any)
        .resolves([generateEmptyBlock()]);
      getBlockRangeFromPeerStub
        .withArgs(sinon.match.any, sinon.match.any, peer2, sinon.match.any)
        .throws();
      const blocks = await getBlockRange(rpcStub, repsStub, peers, {start: 0, end: 4}, 2);
      expect(blocks.length).to.be.equal(2);
    });

    it("no chunks", async function () {
      const peer1 = {id: 1} as unknown as PeerInfo;
      const peers = [peer1];
      const blocks = await getBlockRange(rpcStub, repsStub, peers, {start: 4, end: 4}, 2);
      expect(blocks.length).to.be.equal(0);
    });

  });

});