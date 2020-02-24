import sinon, { SinonStubbedInstance, SinonStub } from "sinon";
import {expect} from "chai";
import PeerInfo from "peer-info";
import PeerId from "peer-id";
import {Goodbye, Status} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {Method, ZERO_HASH} from "../../../src/constants";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {generateState} from "../../utils/state";
import {SyncReqResp} from "../../../src/sync/reqResp";
import {BlockRepository, ChainRepository, StateRepository, BlockArchiveRepository} from "../../../src/db/api/beacon/repositories";
import {ReqResp} from "../../../src/network/reqResp";
import {ReputationStore} from "../../../src/sync/IReputation";
import {generateEmptySignedBlock} from "../../utils/block";
import { IBeaconDb } from "../../db";

describe("syncing", function () {
  const sandbox = sinon.createSandbox();
  let syncRpc: SyncReqResp;
  let chainStub: SinonStubbedInstance<BeaconChain>, networkStub: SinonStubbedInstance<Libp2pNetwork>, repsStub: SinonStubbedInstance<ReputationStore>, logger: WinstonLogger, reqRespStub: SinonStubbedInstance<ReqResp>;
  let dbStub: {
    chain: SinonStubbedInstance<ChainRepository>;
    state: SinonStubbedInstance<StateRepository>;
    block: SinonStubbedInstance<BlockRepository>;
    blockArchive: SinonStubbedInstance<BlockArchiveRepository>;
  };

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.latestState = generateState();
    // @ts-ignore
    chainStub.config = config;
    reqRespStub = sandbox.createStubInstance(ReqResp);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    networkStub.reqResp = reqRespStub as unknown as ReqResp;
    dbStub = {
      chain: sandbox.createStubInstance(ChainRepository),
      state: sandbox.createStubInstance(StateRepository),
      block: sandbox.createStubInstance(BlockRepository),
      blockArchive: sandbox.createStubInstance(BlockArchiveRepository),
    };
    repsStub = sandbox.createStubInstance(ReputationStore);
    logger = new WinstonLogger();
    logger.silent = true;

    syncRpc = new SyncReqResp({}, {
      config,
      db: dbStub as unknown as IBeaconDb,
      chain: chainStub,
      network: networkStub,
      reps: repsStub as unknown as ReputationStore,
      logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });


  it("should able to create Status - genesis time", async function () {
    // chainStub.genesisTime = 0;
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
      latestStatus: null, score: 0
    });


    try {
      await syncRpc.start();
      await syncRpc.stop();

    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request  - onStatus(success)", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    repsStub.get.returns({
      latestStatus: null, score: 0
    });
    reqRespStub.sendResponse.resolves(0);
    dbStub.block.getChainHead.resolves(generateEmptySignedBlock());
    dbStub.state.get.resolves(generateState());
    try {
      await syncRpc.onRequest(peerInfo, Method.Status, "status", body);
      expect(reqRespStub.sendResponse.calledOnce).to.be.true;
      expect(reqRespStub.goodbye.called).to.be.false;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should handle request  - onStatus(error)", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    repsStub.get.returns({
      latestStatus: null, score: 0
    });
    try {
      reqRespStub.sendResponse.throws(new Error("server error"));
      await syncRpc.onRequest(peerInfo, Method.Status, "status", body);
    }catch (e) {
      expect(reqRespStub.sendResponse.called).to.be.true;
    }
  });

  it("should disconnect on status - incorrect headForkVersion", async function() {
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.block.getChainHead.resolves(generateEmptySignedBlock());
    const state = generateState();
    state.fork.currentVersion = Buffer.from("efgh");
    dbStub.state.get.resolves(state);
    expect(await syncRpc.shouldDisconnectOnStatus(body)).to.be.true;
  });

  it("should disconnect on status - incorrect finalized checkpoint", async function() {
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.from("xyz"),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.block.getChainHead.resolves(generateEmptySignedBlock());
    dbStub.blockArchive.get.resolves(generateEmptySignedBlock());
    const state = generateState();
    state.fork.currentVersion = Buffer.alloc(4);
    state.finalizedCheckpoint.epoch = 2;
    dbStub.state.get.resolves(state);
    expect(await syncRpc.shouldDisconnectOnStatus(body)).to.be.true;
  });

  it("should not disconnect on status", async function() {
    const body: Status = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: config.types.BeaconBlock.hashTreeRoot(generateEmptySignedBlock().message),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.block.getChainHead.resolves(generateEmptySignedBlock());
    dbStub.blockArchive.get.resolves(generateEmptySignedBlock());
    const state = generateState();
    state.fork.currentVersion = Buffer.alloc(4);
    state.finalizedCheckpoint.epoch = 1;
    dbStub.state.get.resolves(state);

    expect(await syncRpc.shouldDisconnectOnStatus(body)).to.be.false;
  });

  it("should handle request - onGoodbye", async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const goodbye: Goodbye = 1n;
    networkStub.disconnect.resolves();
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
