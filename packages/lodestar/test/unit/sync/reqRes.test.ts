import sinon from "sinon";
import {expect} from "chai";
import PeerInfo from "peer-info";
import PeerId from "peer-id";
import {Goodbye, Hello,} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "@chainsafe/eth2.0-state-transition/lib/util/blockRoot";

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
  let sandbox = sinon.createSandbox();
  let syncRpc: SyncReqResp;
  let chainStub, networkStub, dbStub, repsStub, logger, reqRespStub, getBlockRootStub;

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
    getBlockRootStub = sandbox.stub(utils, "getBlockRoot");
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


  it('should able to create Hello - genesis time', async function () {
    chainStub.genesisTime = 0;
    chainStub.networkId = 1n;
    chainStub.chainId = 1;

    const expected: Hello = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: ZERO_HASH ,
      finalizedEpoch: 0,
      headRoot: ZERO_HASH,
      headSlot: 0,
    };

    try {
      // @ts-ignore
      let result = await syncRpc.createHello();
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });
  it('should start and stop sync rpc', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    networkStub.hasPeer.returns(true);
    networkStub.getPeers.returns([peerInfo, peerInfo]);
    repsStub.get.returns({
      latestHello: {},
    });


    try {
      await syncRpc.start();
      await syncRpc.stop();

    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request  - onHello(success)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    repsStub.get.returns({
      latestHello: null,
    });
    reqRespStub.sendResponse.resolves(0);
    dbStub.block.getChainHead.resolves(Buffer.alloc(0));
    dbStub.state.get.resolves(generateState());
    try {
      await syncRpc.onRequest(peerInfo, Method.Hello, "hello", body);
      expect(reqRespStub.sendResponse.calledOnce).to.be.true;
      expect(reqRespStub.goodbye.called).to.be.false;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request  - onHello(error)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
    repsStub.get.returns({
      latestHello: null,
    });
    try {
      reqRespStub.sendResponse.throws(new Error("server error"));
      await syncRpc.onRequest(peerInfo, Method.Hello, "hello", body);
    }catch (e) {
      expect(reqRespStub.sendResponse.called).to.be.true;
    }
  });

  it('should disconnect on hello - incorrect headForkVersion', async function() {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.alloc(32),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.block.getChainHead.resolves(Buffer.alloc(0));
    const state = generateState();
    state.fork.currentVersion = Buffer.from("efgh");
    dbStub.state.get.resolves(state);
    expect(await syncRpc.shouldDisconnectOnHello(peerInfo, body)).to.be.true;
  });

  it('should disconnect on hello - incorrect finalized checkpoint', async function() {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.from("xyz"),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.block.getChainHead.resolves(Buffer.alloc(0));
    const state = generateState();
    state.fork.currentVersion = Buffer.alloc(4);
    state.finalizedCheckpoint.epoch = 2;
    dbStub.state.get.resolves(state);
    getBlockRootStub.returns(Buffer.from("not xyz"));
    expect(await syncRpc.shouldDisconnectOnHello(peerInfo, body)).to.be.true;
  });

  it('should not disconnect on hello', async function() {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      headForkVersion: Buffer.alloc(4),
      finalizedRoot: Buffer.from("xyz"),
      finalizedEpoch: 1,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };

    dbStub.block.getChainHead.resolves(Buffer.alloc(0));
    const state = generateState();
    state.fork.currentVersion = Buffer.alloc(4);
    state.finalizedCheckpoint.epoch = 1;
    dbStub.state.get.resolves(state);
    getBlockRootStub.returns(Buffer.from("xyz"));
    expect(await syncRpc.shouldDisconnectOnHello(peerInfo, body)).to.be.false;
  });

  it('should handle request - onGoodbye', async function () {
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

  it('should fail to handle request ', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    try {
      await syncRpc.onRequest(peerInfo, null, "null", null);
    }catch (e) {
      expect.fail(e.stack);
    }
  });
});
