import {Connection} from "libp2p";
import {EventEmitter} from "events";
import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";
import {IReqResp, ReqRespMethod} from "../../../../src/network/reqresp";
import {PeerRpcScoreStore, PeerManager, Libp2pPeerMetadataStore} from "../../../../src/network/peers";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network";
import {createNode, getAttnets, getSyncnets} from "../../../utils/network";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain";
import {generateEmptySignedBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {waitForEvent} from "../../../utils/events/resolver";
import {testLogger} from "../../../utils/logger";
import {getValidPeerId} from "../../../utils/peer";
import {IAttnetsService} from "../../../../src/network/subnets";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";

const logger = testLogger();

describe("network / peers / PeerManager", function () {
  const peerId1 = getValidPeerId();

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function mockModules() {
    // Setup fake chain
    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state,
      config: beaconConfig,
    });
    const libp2p = await createNode("/ip4/127.0.0.1/tcp/0");

    afterEachCallbacks.push(async () => {
      chain.close();
      await libp2p.stop();
    });

    const reqResp = new ReqRespFake();
    const peerMetadata = new Libp2pPeerMetadataStore(libp2p.peerStore.metadataBook);
    const peerRpcScores = new PeerRpcScoreStore(peerMetadata);
    const networkEventBus = new NetworkEventBus();
    /* eslint-disable @typescript-eslint/no-empty-function */
    const mockSubnetsService: IAttnetsService = {
      getActiveSubnets: () => [],
      shouldProcess: () => true,
      addCommitteeSubscriptions: () => {},
      start: () => {},
      stop: () => {},
      subscribeSubnetsToNextFork: () => {},
      unsubscribeSubnetsFromPrevFork: () => {},
    };

    const peerManager = new PeerManager(
      {
        libp2p,
        reqResp,
        logger,
        metrics: null,
        chain,
        config: beaconConfig,
        peerMetadata,
        peerRpcScores,
        networkEventBus,
        attnetsService: mockSubnetsService,
        syncnetsService: mockSubnetsService,
      },
      {
        targetPeers: 30,
        maxPeers: 50,
        discv5: null,
        discv5FirstQueryDelayMs: 0,
      }
    );
    await peerManager.start();

    return {chain, libp2p, reqResp, peerMetadata, peerManager, networkEventBus};
  }

  // Create a real event emitter with stubbed methods
  class ReqRespFake implements IReqResp {
    start = sinon.stub();
    stop = sinon.stub();
    status = sinon.stub();
    metadata = sinon.stub();
    goodbye = sinon.stub();
    ping = sinon.stub();
    beaconBlocksByRange = sinon.stub();
    beaconBlocksByRoot = sinon.stub();
    pruneRateLimiterData = sinon.stub();
  }

  it("Should request metadata on receivedPing of unknown peer", async () => {
    const {reqResp, networkEventBus} = await mockModules();

    const seqNumber = BigInt(2);
    const metadata: phase0.Metadata = {seqNumber, attnets: []};

    // Simulate peer1 responding with its metadata
    reqResp.metadata.resolves(metadata);

    // We get a ping by peer1, don't have it's metadata so it gets requested
    networkEventBus.emit(NetworkEvent.reqRespRequest, {method: ReqRespMethod.Ping, body: seqNumber}, peerId1);

    expect(reqResp.metadata.callCount).to.equal(1, "reqResp.metadata must be called once");
    expect(reqResp.metadata.getCall(0).args[0]).to.equal(peerId1, "reqResp.metadata must be called with peer1");

    // Allow requestMetadata promise to resolve
    await sleep(0);

    // We get another ping by peer1, but with an already known seqNumber
    reqResp.metadata.reset();
    networkEventBus.emit(NetworkEvent.reqRespRequest, {method: ReqRespMethod.Ping, body: seqNumber}, peerId1);

    expect(reqResp.metadata.callCount).to.equal(0, "reqResp.metadata must not be called again");
  });

  const libp2pConnectionOutboud = {
    stat: {direction: "outbound", status: "open"},
    remotePeer: peerId1,
  } as Connection;

  it("Should emit peer connected event on relevant peer status", async function () {
    const {chain, libp2p, networkEventBus} = await mockModules();

    // Simualate a peer connection, get() should return truthy
    libp2p.connectionManager.connections.set(peerId1.toB58String(), [libp2pConnectionOutboud]);

    // Subscribe to `peerConnected` event, which must fire after checking peer relevance
    const peerConnectedPromise = waitForEvent(networkEventBus, NetworkEvent.peerConnected, this.timeout() / 2);

    // Send the local status and remote status, which always passes the assertPeerRelevance function
    const remoteStatus = chain.getStatus();
    networkEventBus.emit(NetworkEvent.reqRespRequest, {method: ReqRespMethod.Status, body: remoteStatus}, peerId1);

    await peerConnectedPromise;
  });

  it("On peerConnect handshake flow", async function () {
    const {chain, libp2p, reqResp, peerMetadata, networkEventBus} = await mockModules();

    // Simualate a peer connection, get() should return truthy
    libp2p.connectionManager.get = sinon.stub().returns({});

    // Subscribe to `peerConnected` event, which must fire after checking peer relevance
    const peerConnectedPromise = waitForEvent(networkEventBus, NetworkEvent.peerConnected, this.timeout() / 2);

    // Simulate peer1 returning a PING and STATUS message
    const remoteStatus = chain.getStatus();
    const remoteMetadata: altair.Metadata = {seqNumber: BigInt(1), attnets: getAttnets(), syncnets: getSyncnets()};
    reqResp.ping.resolves(remoteMetadata.seqNumber);
    reqResp.status.resolves(remoteStatus);
    reqResp.metadata.resolves(remoteMetadata);

    // Simualate a peer connection, get() should return truthy
    libp2p.connectionManager.connections.set(peerId1.toB58String(), [libp2pConnectionOutboud]);
    ((libp2p.connectionManager as any) as EventEmitter).emit("peer:connect", libp2pConnectionOutboud);

    await peerConnectedPromise;

    // Allow requestMetadata promise to resolve
    await sleep(0);

    // After receiving the "peer:connect" event, the PeerManager must
    // 1. Call reqResp.ping
    // 2. Call reqResp.status
    // 3. Receive ping result (1) and call reqResp.metadata
    // 4. Receive status result (2) assert peer relevance and emit `PeerManagerEvent.peerConnected`
    expect(reqResp.ping.callCount).to.equal(1, "reqResp.ping must be called");
    expect(reqResp.status.callCount).to.equal(1, "reqResp.status must be called");
    expect(reqResp.metadata.callCount).to.equal(1, "reqResp.metadata must be called");

    expect(peerMetadata.metadata.get(peerId1)).to.deep.equal(remoteMetadata, "Wrong stored metadata");
  });
});
