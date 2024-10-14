import {describe, it, afterEach, expect, vi} from "vitest";
import {Connection} from "@libp2p/interface";
import {BitArray} from "@chainsafe/ssz";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {config} from "@lodestar/config/default";
import {altair, phase0, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {createBeaconConfig} from "@lodestar/config";
import {ReqRespMethod} from "../../../../src/network/reqresp/ReqRespBeaconNode.js";
import {PeerRpcScoreStore, PeerManager, IReqRespBeaconNodePeerManager} from "../../../../src/network/peers/index.js";
import {Eth2Gossipsub, getConnectionsMap, NetworkEvent, NetworkEventBus} from "../../../../src/network/index.js";
import {PeersData} from "../../../../src/network/peers/peersData.js";
import {createNode} from "../../../utils/network.js";
import {getAttnets, getSyncnets} from "../../../utils/network.js";
import {generateState} from "../../../utils/state.js";
import {waitForEvent} from "../../../utils/events/resolver.js";
import {testLogger} from "../../../utils/logger.js";
import {getValidPeerId} from "../../../utils/peer.js";
import {IAttnetsService} from "../../../../src/network/subnets/index.js";
import {Clock} from "../../../../src/util/clock.js";
import {LocalStatusCache} from "../../../../src/network/statusCache.js";

const logger = testLogger("peerManager");

describe("network / peers / PeerManager", () => {
  const peerId1 = getValidPeerId();

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function mockModules() {
    // Setup fake chain
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
    const controller = new AbortController();
    const clock = new Clock({config: beaconConfig, genesisTime: 0, signal: controller.signal});
    const status = ssz.phase0.Status.defaultValue();
    const statusCache = new LocalStatusCache(status);
    const privateKey = await generateKeyPair("secp256k1");
    const libp2p = await createNode("/ip4/127.0.0.1/tcp/0", privateKey);

    afterEachCallbacks.push(async () => {
      controller.abort();
      await libp2p.stop();
    });

    const reqResp = new ReqRespFake();
    const peerRpcScores = new PeerRpcScoreStore();
    const networkEventBus = new NetworkEventBus();
    const mockSubnetsService: IAttnetsService = {
      getActiveSubnets: () => [],
      shouldProcess: () => true,
      addCommitteeSubscriptions: () => {},
      close: () => {},
      subscribeSubnetsToNextFork: () => {},
      unsubscribeSubnetsFromPrevFork: () => {},
    };

    const peerManager = new PeerManager(
      {
        privateKey,
        libp2p,
        reqResp,
        logger,
        metrics: null,
        clock,
        statusCache,
        config: beaconConfig,
        peerRpcScores,
        events: networkEventBus,
        attnetsService: mockSubnetsService,
        syncnetsService: mockSubnetsService,
        gossip: {getScore: () => 0, scoreParams: {decayInterval: 1000}} as unknown as Eth2Gossipsub,
        peersData: new PeersData(),
      },
      {
        targetPeers: 30,
        maxPeers: 50,
        discv5: null,
        discv5FirstQueryDelayMs: 0,
      },
      null
    );

    afterEachCallbacks.push(async () => {
      await peerManager.close();
    });

    return {statusCache, clock, libp2p, reqResp, peerManager, networkEventBus};
  }

  // Create a real event emitter with stubbed methods
  class ReqRespFake implements IReqRespBeaconNodePeerManager {
    sendStatus = vi.fn();
    sendMetadata = vi.fn();
    sendGoodbye = vi.fn();
    sendPing = vi.fn();
  }

  it("Should request metadata on receivedPing of unknown peer", async () => {
    const {reqResp, networkEventBus, peerManager} = await mockModules();

    // Simulate connection so that PeerManager persists the metadata response
    await peerManager["onLibp2pPeerConnect"](
      new CustomEvent("evt", {
        detail: {
          direction: "inbound",
          status: "open",
          remotePeer: peerId1,
        } as Connection,
      })
    );

    const seqNumber = BigInt(2);
    const metadata: phase0.Metadata = {seqNumber, attnets: BitArray.fromBitLen(0)};

    // Simulate peer1 responding with its metadata
    reqResp.sendMetadata.mockResolvedValue(metadata);

    // We get a ping by peer1, don't have it's metadata so it gets requested
    networkEventBus.emit(NetworkEvent.reqRespRequest, {
      request: {method: ReqRespMethod.Ping, body: seqNumber},
      peer: peerId1,
    });

    expect(reqResp.sendMetadata).toHaveBeenCalledOnce();
    expect(reqResp.sendMetadata).toHaveBeenNthCalledWith(1, peerId1);

    // Allow requestMetadata promise to resolve
    await sleep(0);

    // We get another ping by peer1, but with an already known seqNumber
    reqResp.sendMetadata.mockReset();
    networkEventBus.emit(NetworkEvent.reqRespRequest, {
      request: {method: ReqRespMethod.Ping, body: seqNumber},
      peer: peerId1,
    });

    expect(reqResp.sendMetadata).not.toHaveBeenCalledOnce();
  });

  const libp2pConnectionOutboud = {
    direction: "outbound",
    status: "open",
    remotePeer: peerId1,
  } as Connection;

  it("Should emit peer connected event on relevant peer status", async () => {
    const {statusCache, libp2p, networkEventBus} = await mockModules();

    // Simualate a peer connection, get() should return truthy
    getConnectionsMap(libp2p).set(peerId1.toString(), {key: peerId1, value: [libp2pConnectionOutboud]});

    // Subscribe to `peerConnected` event, which must fire after checking peer relevance
    const peerConnectedPromise = waitForEvent(networkEventBus, NetworkEvent.peerConnected, 2000);

    // Send the local status and remote status, which always passes the assertPeerRelevance function
    const remoteStatus = statusCache.get();
    networkEventBus.emit(NetworkEvent.reqRespRequest, {
      request: {method: ReqRespMethod.Status, body: remoteStatus},
      peer: peerId1,
    });

    await peerConnectedPromise;
  });

  it("On peerConnect handshake flow", async () => {
    const {statusCache, libp2p, reqResp, peerManager, networkEventBus} = await mockModules();

    // Simualate a peer connection, get() should return truthy
    getConnectionsMap(libp2p).set(peerId1.toString(), {key: peerId1, value: [libp2pConnectionOutboud]});

    // Subscribe to `peerConnected` event, which must fire after checking peer relevance
    const peerConnectedPromise = waitForEvent(networkEventBus, NetworkEvent.peerConnected, 2000);

    // Simulate peer1 returning a PING and STATUS message
    const remoteStatus = statusCache.get();
    const remoteMetadata: altair.Metadata = {seqNumber: BigInt(1), attnets: getAttnets(), syncnets: getSyncnets()};
    reqResp.sendPing.mockResolvedValue(remoteMetadata.seqNumber);
    reqResp.sendStatus.mockResolvedValue(remoteStatus);
    reqResp.sendMetadata.mockResolvedValue(remoteMetadata);

    // Simualate a peer connection, get() should return truthy
    getConnectionsMap(libp2p).set(peerId1.toString(), {key: peerId1, value: [libp2pConnectionOutboud]});
    libp2p.services.components.events.dispatchEvent(
      new CustomEvent("connection:open", {detail: libp2pConnectionOutboud})
    );

    await peerConnectedPromise;

    // Allow requestMetadata promise to resolve
    await sleep(0);

    // After receiving the "peer:connect" event, the PeerManager must
    // 1. Call reqResp.sendPing
    // 2. Call reqResp.sendStatus
    // 3. Receive ping result (1) and call reqResp.sendMetadata
    // 4. Receive status result (2) assert peer relevance and emit `PeerManagerEvent.peerConnected`
    expect(reqResp.sendPing).toHaveBeenCalledOnce();
    expect(reqResp.sendStatus).toHaveBeenCalledOnce();
    expect(reqResp.sendMetadata).toHaveBeenCalledOnce();

    expect(peerManager["connectedPeers"].get(peerId1.toString())?.metadata).toEqual(remoteMetadata);
  });
});
