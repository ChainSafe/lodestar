import sinon from "sinon";
import {expect} from "chai";
// @ts-ignore
import PeerInfo from "peer-info";
// @ts-ignore
import PeerId from "peer-id";
import {Goodbye, Status} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {describe, it, beforeEach, afterEach} from "mocha";
import {Method, ZERO_HASH} from "../../../src/constants";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {WinstonLogger} from "../../../src/logger";
import {generateState} from "../../utils/state";
import {SyncReqResp} from "../../../src/sync/reqResp";
import {BlockRepository, ChainRepository, StateRepository} from "../../../src/db/api/beacon/repositories";
import {ReqResp} from "../../../src/network/reqResp";
import {ReputationStore} from "../../../src/sync/IReputation";

describe("syncing", function () {
  const sandbox = sinon.createSandbox();
  let syncRpc: SyncReqResp;
  let chainStub: any, networkStub: any, dbStub: any, repsStub: any, logger: any, reqRespStub: any;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.latestState = generateState();
    chainStub.config = config;
    reqRespStub = sandbox.createStubInstance(ReqResp);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    networkStub.reqResp = reqRespStub;
    dbStub = {
      chain: sandbox.createStubInstance(ChainRepository),
      state: sandbox.createStubInstance(StateRepository),
      block: sandbox.createStubInstance(BlockRepository),
    };
    repsStub = sandbox.createStubInstance(ReputationStore);
    logger = new WinstonLogger();
    logger.silent = true;

    syncRpc = new SyncReqResp({}, {
      config,
      db: dbStub,
      chain: chainStub,
      network: networkStub,
      reps: repsStub,
      logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });


  it("should able to create Status - genesis time", async function () {
    chainStub.genesisTime = 0;
    chainStub.networkId = 1n;
    chainStub.chainId = 1;

    const expected: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: ZERO_HASH ,
      finalizedEpoch: 0,
      headRoot: ZERO_HASH,
      headSlot: 0,
    };

    try {
      // @ts-ignore
      const result = await syncRpc.createStatus();
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });
  it("should start and stop sync rpc", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    networkStub.hasPeer.returns(true);
    networkStub.getPeers.returns([peerInfo, peerInfo]);
    repsStub.get.returns({
      latestStatus: {},
    });


    try {
      await syncRpc.start();
      await syncRpc.stop();

    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request  - onHello(success)", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    repsStub.get.returns({
      latestStatus: null,
    });
    reqRespStub.sendResponse.resolves(0);
    try {
      await syncRpc.onRequest(peerInfo, Method.Status, "status", body);
      expect(reqRespStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request  - onHello(error)", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    repsStub.get.returns({
      latestStatus: null,
    });
    try {
      reqRespStub.sendResponse.throws(new Error("server error"));
      await syncRpc.onRequest(peerInfo, Method.Status, "status", body);
    }catch (e) {
      expect(reqRespStub.sendResponse.called).to.be.true;
    }
  });


  it("should handle request - onGoodbye", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const goodbye: Goodbye = 1n;
    networkStub.disconnect.resolves(0);
    try {
      await syncRpc.onRequest(peerInfo, Method.Goodbye, "goodBye", goodbye);
      expect(networkStub.disconnect.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should fail to handle request ", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    try {
      await syncRpc.onRequest(peerInfo, null, "null", null);
    }catch (e) {
      expect.fail(e.stack);
    }
  });
});
