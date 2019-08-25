import BN from "bn.js";
import sinon from "sinon";
import {expect} from "chai";
import PeerInfo from "peer-info";
import PeerId from "peer-id";
import {
  BeaconBlockBodiesRequest,
  BeaconBlockBodiesResponse,
  BeaconBlockHeadersRequest,
  BeaconBlockHeadersResponse,
  BeaconBlockRootsRequest,
  BeaconBlockRootsResponse,
  BeaconState,
  BeaconStatesRequest,
  Goodbye,
  Hello,
  Status,
} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {EMPTY_SIGNATURE, Method, ZERO_HASH} from "../../../src/constants";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {WinstonLogger} from "../../../src/logger";
import {generateState} from "../../utils/state";
import {SyncRpc} from "../../../src/network/libp2p/syncRpc";
import {intDiv} from "../../../src/util/math";
import {ReputationStore} from "../../../src/sync/reputation";
import {generateEmptyBlock} from "../../utils/block";
import {BlockRepository, ChainRepository, StateRepository} from "../../../src/db/api/beacon/repositories";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let syncRpc: SyncRpc;
  let chainStub, networkStub, dbStub, repsStub, logger;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    dbStub = {
      chain: sandbox.createStubInstance(ChainRepository),
      state: sandbox.createStubInstance(StateRepository),
      block: sandbox.createStubInstance(BlockRepository),
    };
    repsStub = sandbox.createStubInstance(ReputationStore);
    logger = new WinstonLogger();
    logger.silent = true;

    syncRpc = new SyncRpc({}, {
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
    chainStub.networkId = new BN(1);
    chainStub.chainId = 1;

    const expected: Hello = {
      networkId: chainStub.networkId,
      chainId: chainStub.chainId,
      latestFinalizedRoot: ZERO_HASH ,
      latestFinalizedEpoch: 0,
      bestRoot: ZERO_HASH,
      bestSlot: 0,
    };

    try {
      let result = await syncRpc.createHello();
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });
  it('should able to create Hello - non genesis time', async function () {
    chainStub.genesisTime = 10;
    chainStub.networkId = new BN(1);
    chainStub.chainId = 1;
    dbStub.chain.getChainHeadSlot.resolves(1);
    dbStub.chain.getBlockRoot.resolves(ZERO_HASH);
    const state = generateState();
    state.finalizedCheckpoint.epoch = 1;
    state.finalizedCheckpoint.root = ZERO_HASH;

    dbStub.state.getLatest.resolves(state);

    const expected: Hello = {
      networkId: chainStub.networkId,
      chainId: chainStub.chainId,
      latestFinalizedRoot: ZERO_HASH ,
      latestFinalizedEpoch: 0,
      bestRoot: ZERO_HASH,
      bestSlot: 0,
    };

    try {
      let result = await syncRpc.createHello();
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should able to create Status', async function () {
    const expected =  {
      sha: Buffer.alloc(32),
      userAgent: Buffer.from("Lodestar"),
      timestamp: intDiv(Date.now(), 1000),
    };
    try {
      let result = await syncRpc.createStatus();
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

  it('should refresh Hellos', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    networkStub.getPeers.returns([peerInfo, peerInfo]);
    try {
      await syncRpc.refreshPeerHellos();
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should return Hello', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    chainStub.genesisTime = 0;
    chainStub.networkId = new BN(1);
    chainStub.chainId = 1;
    const expected: Hello = {
      networkId: chainStub.networkId,
      chainId: chainStub.chainId,
      latestFinalizedRoot: ZERO_HASH ,
      latestFinalizedEpoch: 0,
      bestRoot: ZERO_HASH,
      bestSlot: 0,
    };
    networkStub.sendRequest.resolves(expected);
    repsStub.get.returns({
      latestHello: null,
    });
    try {
      const  result =  await syncRpc.getHello(peerInfo);
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should return GoodBye', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));

    const expected: Goodbye = {
      reason: new BN(1),
    };
    networkStub.sendRequest.resolves(expected);
    try {
      const  result =  await syncRpc.getGoodbye(peerInfo);
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should return Status', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));

    const expected: Status = {
      sha: Buffer.alloc(32),
      userAgent: null,
      timestamp: null,
    };
    networkStub.sendRequest.resolves(expected);
    repsStub.get.returns({
      latestHellow: null
    });
    try {
      const  result =  await syncRpc.getStatus(peerInfo);
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should return beacon block roots', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const expected: BeaconBlockRootsResponse = {
      roots:[{
        blockRoot: Buffer.alloc(32),
        slot:0,
      }]
    };
    networkStub.sendRequest.resolves(expected);
    try {
      const  result =  await syncRpc.getBeaconBlockRoots(peerInfo, 0, 0);
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should return beacon block headers', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const expected: BeaconBlockHeadersResponse = {
      headers: [{
        slot: 0,
        parentRoot: Buffer.alloc(32),
        stateRoot: Buffer.alloc(32),
        bodyRoot: Buffer.alloc(32),
        signature: EMPTY_SIGNATURE,
      }]
    };
    networkStub.sendRequest.resolves(expected);
    try {
      const  result =  await syncRpc.getBeaconBlockHeaders(
        peerInfo, Buffer.alloc(32),
        0,
        64,
        0
      );
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });


  it('should return beacon block bodies', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const expected: BeaconBlockBodiesResponse = {
      blockBodies: []
    };
    networkStub.sendRequest.resolves(expected);
    try {
      const  result =  await syncRpc.getBeaconBlockBodies(peerInfo, [Buffer.alloc(32)]);
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should return beacon states', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const expected: BeaconState[] = [];
    networkStub.sendRequest.resolves({
      states: []
    });
    try {
      const  result =  await syncRpc.getBeaconStates(peerInfo, [Buffer.alloc(32)]);
      expect(result).deep.equal(expected);
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request  - onHello(success)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      networkId: new BN(1),
      chainId: 1,
      latestFinalizedRoot: Buffer.alloc(32),
      latestFinalizedEpoch: 1,
      bestRoot: Buffer.alloc(32),
      bestSlot: 1,
    };
    repsStub.get.returns({
      latestHello: null,
    });
    networkStub.sendResponse.resolves(0);
    try {
      await syncRpc.onRequest(peerInfo, Method.Hello, "hello", body);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request  - onHello(error)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const body: Hello = {
      networkId: new BN(1),
      chainId: 1,
      latestFinalizedRoot: Buffer.alloc(32),
      latestFinalizedEpoch: 1,
      bestRoot: Buffer.alloc(32),
      bestSlot: 1,
    };
    repsStub.get.returns({
      latestHello: null,
    });
    try {
      networkStub.sendResponse.throws(new Error("server error"));
      await syncRpc.onRequest(peerInfo, Method.Hello, "hello", body);
    }catch (e) {
      expect(networkStub.sendResponse.calledTwice).to.be.true;
    }
  });


  it('should handle request - onGoodbye', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const goodbye: Goodbye = {
      reason: new BN(1),
    };
    networkStub.disconnect.resolves(0);
    try {
      await syncRpc.onRequest(peerInfo, Method.Goodbye, "goodBye", goodbye);
      expect(networkStub.disconnect.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onStatus', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const status: Status = {
      sha: Buffer.alloc(32),
      userAgent: null,
      timestamp: null,
    };
    repsStub.get.returns({
      latestStatus: null,
    });
    networkStub.sendResponse.resolves(0);
    try {
      await syncRpc.onRequest(peerInfo, Method.Status, "status", status);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onBeaconBlockRoots', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconBlockRootsRequest: BeaconBlockRootsRequest = {
      startSlot: 0,
      count: 1,
    };
    repsStub.get.returns({
      latestStatus: null,
    });
    networkStub.sendResponse.resolves(0);
    dbStub.chain.getBlockRoot.resolves(Buffer.alloc(32));
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconBlockRoots, "beaconBlockRoots", beaconBlockRootsRequest);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onBeaconBlockRoots(block root not found)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconBlockRootsRequest: BeaconBlockRootsRequest = {
      startSlot: 0,
      count: 1,
    };
    repsStub.get.returns({
      latestStatus: null,
    });
    networkStub.sendResponse.resolves(0);
    dbStub.chain.getBlockRoot.throws("block root not found");
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconBlockRoots, "beaconBlockRoots", beaconBlockRootsRequest);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onBeaconBlockHeaders(success)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconBlockHeadersRequest: BeaconBlockHeadersRequest = {
      startRoot: Buffer.from("BeaconBlockHeaders"),
      startSlot: 0,
      maxHeaders: 1,
      skipSlots: 1,
    };
    networkStub.sendResponse.resolves(0);
    dbStub.chain.getBlockRoot.resolves(Buffer.from("BeaconBlockHeaders"));
    dbStub.block.getBlockBySlot.resolves(generateEmptyBlock());
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconBlockHeaders, "beaconBlockHeaders", beaconBlockHeadersRequest);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onBeaconBlockHeaders(error)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconBlockHeadersRequest: BeaconBlockHeadersRequest = {
      startRoot: Buffer.from("BeaconBlockHeaders"),
      startSlot: 0,
      maxHeaders: 1,
      skipSlots: 1,
    };
    networkStub.sendResponse.throws("server error");
    dbStub.chain.getBlockRoot.resolves(Buffer.from("BeaconBlockHeaders"));
    dbStub.block.getBlockBySlot.throws("block not found");
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconBlockHeaders, "beaconBlockHeaders", beaconBlockHeadersRequest);
    }catch (e) {
      expect(networkStub.sendResponse.calledTwice).to.be.true;
    }
  });

  it('should handle request - onBeaconBlockBodies', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconBlockBodiesRequest: BeaconBlockBodiesRequest = {
      blockRoots: [Buffer.from("BeaconBlockBodies")],
    };
    networkStub.sendResponse.resolves(0);
    dbStub.block.get.resolves(generateEmptyBlock());
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconBlockBodies, "beaconBlockBodies", beaconBlockBodiesRequest);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onBeaconBlockBodies(block not found)', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconBlockBodiesRequest: BeaconBlockBodiesRequest = {
      blockRoots: [Buffer.from("BeaconBlockBodies")],
    };
    networkStub.sendResponse.resolves(0);
    dbStub.block.get.throws("block not found");
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconBlockBodies, "beaconBlockBodies", beaconBlockBodiesRequest);
      expect(networkStub.sendResponse.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should handle request - onBeaconStates', async function () {
    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    const beaconStatesRequest: BeaconStatesRequest = {
      hashes: [Buffer.from("BeaconStates")],
    };
    try {
      await syncRpc.onRequest(peerInfo, Method.BeaconStates, "beaconStates", beaconStatesRequest);
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

  it('should fail to sync - root length zero ', async function () {
    const getBeaconBlockRootsStub = sinon.stub(syncRpc, "getBeaconBlockRoots");

    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    repsStub.get.returns({
      latestStatus: null,
    });
    networkStub.sendResponse.resolves(0);
    dbStub.chain.getBlockRoot.resolves(Buffer.alloc(32));
    getBeaconBlockRootsStub.resolves({
      roots: []
    });

    try {
      await syncRpc.getBeaconBlocks(peerInfo, 0, 1, false);
      expect.fail();
    }catch (e) {
      expect(getBeaconBlockRootsStub.calledOnce).to.be.true;
    }

  });


  it('should fail to sync - headers length mismatch with blockBodies length ', async function () {
    const getBeaconBlockRootsStub = sinon.stub(syncRpc, "getBeaconBlockRoots");
    const getBeaconBlockHeadersStub = sinon.stub(syncRpc, "getBeaconBlockHeaders");
    const getBeaconBlockBodiesStub = sinon.stub(syncRpc, "getBeaconBlockBodies");

    const peerInfo: PeerInfo = new PeerInfo(new PeerId(Buffer.from("lodestar")));
    repsStub.get.returns({
      latestStatus: null,
    });
    networkStub.sendResponse.resolves(0);
    dbStub.chain.getBlockRoot.resolves(Buffer.alloc(32));
    getBeaconBlockRootsStub.resolves({
      roots: [{
        blockRoot: Buffer.alloc(32),
        slot: 1
      }]
    });
    getBeaconBlockHeadersStub.resolves({
      headers: []
    });
    getBeaconBlockBodiesStub.resolves({
      blockBodies: [generateEmptyBlock().body, generateEmptyBlock().body]
    });

    try {
      await syncRpc.getBeaconBlocks(peerInfo, 0, 1, false);
      expect.fail();
    }catch (e) {
      expect(getBeaconBlockHeadersStub.calledOnce).to.be.true;
      expect(getBeaconBlockHeadersStub.calledOnce).to.be.true;
    }

  });


});
