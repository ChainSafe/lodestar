import {generateKeyPair} from "@libp2p/crypto/keys";
import {Connection} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {afterEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {phase0, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {GoodByeReasonCode} from "../../../../src/constants/network.js";
import {Eth2Gossipsub, NetworkEvent, NetworkEventBus, getConnectionsMap} from "../../../../src/network/index.js";
import {SubnetType} from "../../../../src/network/metadata.js";
import {NetworkConfig} from "../../../../src/network/networkConfig.js";
import {ClientKind} from "../../../../src/network/peers/client.js";
import {PeerDiscovery} from "../../../../src/network/peers/discover.js";
import {
  IReqRespBeaconNodePeerManager,
  PeerAction,
  PeerManager,
  PeerRpcScoreStore,
} from "../../../../src/network/peers/index.js";
import {PeersData} from "../../../../src/network/peers/peersData.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/ReqRespBeaconNode.js";
import {LocalStatusCache} from "../../../../src/network/statusCache.js";
import {IAttnetsService, computeNodeId} from "../../../../src/network/subnets/index.js";
import {Clock} from "../../../../src/util/clock.js";
import {CustodyConfig, getCustodyGroups} from "../../../../src/util/dataColumns.js";
import {waitForEvent} from "../../../utils/events/resolver.js";
import {createNode, getAttnets, getSyncnets} from "../../../utils/network.js";
import {getRandPeerIdStr, getValidPeerId} from "../../../utils/peer.js";
import {generateState} from "../../../utils/state.js";

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

  async function mockModules(opts?: {preOpenConnections?: Connection[]; discovery?: PeerDiscovery}) {
    // Setup fake chain
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
    const nodeId = computeNodeId(peerId1);
    const networkConfig: NetworkConfig = {
      nodeId,
      config: beaconConfig,
      custodyConfig: new CustodyConfig({
        nodeId,
        config,
      }),
    };
    const controller = new AbortController();
    const clock = new Clock({config: beaconConfig, genesisTime: 0, signal: controller.signal});
    const status = ssz.phase0.Status.defaultValue();
    const statusCache = new LocalStatusCache(status);
    const privateKey = await generateKeyPair("secp256k1");
    const libp2p = await createNode(["/ip4/127.0.0.1/udp/0/quic-v1", "/ip4/127.0.0.1/tcp/0"], privateKey);

    afterEachCallbacks.push(async () => {
      controller.abort();
      await libp2p.stop();
    });

    const reqResp = new ReqRespFake();
    reqResp.sendPing.mockResolvedValue(BigInt(0));
    reqResp.sendStatus.mockResolvedValue(status);

    if (opts?.preOpenConnections) {
      for (const connection of opts.preOpenConnections) {
        getConnectionsMap(libp2p).set(connection.remotePeer.toString(), {
          key: connection.remotePeer,
          value: [connection],
        });
      }
    }

    const peerRpcScores = new PeerRpcScoreStore();
    const networkEventBus = new NetworkEventBus();
    const mockSubnetsService: IAttnetsService = {
      getActiveSubnets: () => [],
      shouldProcess: () => true,
      addCommitteeSubscriptions: () => {},
      close: () => {},
      subscribeSubnetsNextBoundary: () => {},
      unsubscribeSubnetsPrevBoundary: () => {},
    };
    const gossip = {
      getScore: () => 0,
      scoreParams: {decayInterval: 1000},
      getSubscribersWithOutboundStream: vi.fn<Eth2Gossipsub["getSubscribersWithOutboundStream"]>(),
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
        networkConfig,
        peerRpcScores,
        events: networkEventBus,
        attnetsService: mockSubnetsService,
        syncnetsService: mockSubnetsService,
        gossip: gossip as unknown as Eth2Gossipsub,
        peersData: new PeersData(),
      },
      {
        targetPeers: 30,
        targetGroupPeers: 6,
        maxPeers: 50,
        discv5: null,
        discv5FirstQueryDelayMs: 0,
      },
      opts?.discovery ?? null
    );

    afterEachCallbacks.push(async () => {
      await peerManager.close();
    });

    return {statusCache, clock, libp2p, reqResp, peerManager, networkEventBus, gossip, mockSubnetsService};
  }

  // Create a real event emitter with stubbed methods
  class ReqRespFake implements IReqRespBeaconNodePeerManager {
    sendStatus = vi.fn();
    sendMetadata = vi.fn();
    sendGoodbye = vi.fn();
    sendPing = vi.fn();
  }

  it.each([
    {name: "banned", action: PeerAction.Fatal, actionCount: 1, reason: GoodByeReasonCode.BANNED},
    {name: "low-score", action: PeerAction.LowToleranceError, actionCount: 3, reason: GoodByeReasonCode.SCORE_TOO_LOW},
  ])(
    "excludes $name and disconnected subscribers from coverage before goodbye completes",
    async ({action, actionCount, reason}) => {
      const discovery = {
        discoverPeers: vi.fn<PeerDiscovery["discoverPeers"]>(),
        stop: vi.fn<PeerDiscovery["stop"]>(),
      };
      const {libp2p, reqResp, peerManager, gossip, mockSubnetsService} = await mockModules({
        discovery: discovery as unknown as PeerDiscovery,
      });
      const healthyPeer = peerIdFromPrivateKey(await generateKeyPair("secp256k1"));
      vi.spyOn(peerManager, "getConnectedPeerIds").mockReturnValue([healthyPeer, peerId1]);
      vi.spyOn(mockSubnetsService, "getActiveSubnets").mockReturnValue([{subnet: 3, toSlot: 10}]);
      const subscribers = new Set([healthyPeer.toString(), peerId1.toString(), await getRandPeerIdStr()]);
      gossip.getSubscribersWithOutboundStream.mockReturnValue(subscribers);
      reqResp.sendGoodbye.mockResolvedValue(undefined);
      const hangUp = vi.spyOn(libp2p, "hangUp").mockResolvedValue(undefined);
      for (let i = 0; i < actionCount; i++) {
        peerManager.reportPeer(peerId1, action, "test");
      }

      discovery.discoverPeers.mockClear();
      peerManager.onCommitteeSubscriptions();

      expect(reqResp.sendGoodbye).toHaveBeenCalledExactlyOnceWith(peerId1, BigInt(reason));
      expect(hangUp).not.toHaveBeenCalled();
      expect(discovery.discoverPeers).toHaveBeenCalledExactlyOnceWith(expect.any(Number), expect.any(Map), [
        expect.objectContaining({type: SubnetType.attnets, subnet: 3, maxPeersToDiscover: 5}),
        expect.objectContaining({type: SubnetType.syncnets, subnet: 3, maxPeersToDiscover: 5}),
      ]);

      await sleep(0);
      expect(hangUp).toHaveBeenCalledExactlyOnceWith(peerId1);
    }
  );

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
      peerClient: "Unknown",
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
      peerClient: "Unknown",
    });

    expect(reqResp.sendMetadata).not.toHaveBeenCalledOnce();
  });

  const libp2pConnectionOutboud = {
    direction: "outbound",
    status: "open",
    remotePeer: peerId1,
    close: async () => {},
    abort: () => {},
  } as unknown as Connection;

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
      peerClient: "Unknown",
    });

    await peerConnectedPromise;
  });

  it("Bootstraps already-open outbound connections at startup", async () => {
    const {reqResp, peerManager} = await mockModules({preOpenConnections: [libp2pConnectionOutboud]});

    // Constructor bootstrap is async (requestPing/requestStatus), allow microtasks to flush.
    await sleep(0);

    expect(peerManager["connectedPeers"].has(peerId1.toString())).toBe(true);
    expect(reqResp.sendPing).toHaveBeenCalledOnce();
    expect(reqResp.sendStatus).toHaveBeenCalledOnce();
  });

  it("On peerConnect handshake flow", async () => {
    const {statusCache, libp2p, reqResp, peerManager, networkEventBus} = await mockModules();

    // Simualate a peer connection, get() should return truthy
    getConnectionsMap(libp2p).set(peerId1.toString(), {key: peerId1, value: [libp2pConnectionOutboud]});

    // Subscribe to `peerConnected` event, which must fire after checking peer relevance
    const peerConnectedPromise = waitForEvent(networkEventBus, NetworkEvent.peerConnected, 2000);

    // Simulate peer1 returning a PING and STATUS message
    const remoteStatus = statusCache.get();
    const custodyGroupCount = config.CUSTODY_REQUIREMENT;
    const samplingGroupCount = config.SAMPLES_PER_SLOT;
    const remoteMetadata: NonNullable<ReturnType<PeerManager["connectedPeers"]["get"]>>["metadata"] = {
      seqNumber: BigInt(1),
      attnets: getAttnets(),
      syncnets: getSyncnets(),
      custodyGroupCount,
      custodyGroups: getCustodyGroups(config, computeNodeId(peerId1), custodyGroupCount),
      samplingGroups: getCustodyGroups(config, computeNodeId(peerId1), samplingGroupCount),
    };
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
    expect(reqResp.sendStatus).toHaveBeenCalledTimes(2);
    expect(reqResp.sendMetadata).toHaveBeenCalledOnce();

    expect(peerManager["connectedPeers"].get(peerId1.toString())?.metadata).toEqual(remoteMetadata);
  });

  it("Should identify peer after successful status", async () => {
    const {libp2p, peerManager, statusCache, networkEventBus} = await mockModules();

    vi.spyOn(libp2p.services.identify, "identify").mockImplementation(
      () => Promise.resolve({agentVersion: "Lighthouse/v6.0.1"}) as ReturnType<typeof libp2p.services.identify.identify>
    );

    const inboundConnection = {
      id: "connection-1",
      direction: "inbound",
      status: "open",
      remotePeer: peerId1,
      close: async () => {},
      abort: () => {},
    } as unknown as Connection;

    // Connection open does NOT trigger identify
    getConnectionsMap(libp2p).set(peerId1.toString(), {key: peerId1, value: [inboundConnection]});
    await peerManager["onLibp2pPeerConnect"](new CustomEvent("evt", {detail: inboundConnection}));
    await sleep(0);
    expect(libp2p.services.identify.identify).not.toHaveBeenCalled();

    // Status proves the connection is usable — triggers identify
    const remoteStatus = statusCache.get();
    networkEventBus.emit(NetworkEvent.reqRespRequest, {
      request: {method: ReqRespMethod.Status, body: remoteStatus},
      peer: peerId1,
      peerClient: "Unknown",
    });
    await sleep(0);

    expect(libp2p.services.identify.identify).toHaveBeenCalledTimes(1);
    const peerData = peerManager["connectedPeers"].get(peerId1.toString());
    expect(peerData?.agentVersion).toBe("Lighthouse/v6.0.1");
    expect(peerData?.agentClient).toBe(ClientKind.Lighthouse);
  });

  it("Should not re-identify after second status if agentVersion is already known", async () => {
    const {libp2p, peerManager, statusCache, networkEventBus} = await mockModules();

    vi.spyOn(libp2p.services.identify, "identify").mockImplementation(
      () => Promise.resolve({agentVersion: "Nimbus/v25.0.0"}) as ReturnType<typeof libp2p.services.identify.identify>
    );

    const inboundConnection = {
      id: "connection-1",
      direction: "inbound",
      status: "open",
      remotePeer: peerId1,
      close: async () => {},
      abort: () => {},
    } as unknown as Connection;

    getConnectionsMap(libp2p).set(peerId1.toString(), {key: peerId1, value: [inboundConnection]});
    await peerManager["onLibp2pPeerConnect"](new CustomEvent("evt", {detail: inboundConnection}));

    // First status triggers identify
    const remoteStatus = statusCache.get();
    networkEventBus.emit(NetworkEvent.reqRespRequest, {
      request: {method: ReqRespMethod.Status, body: remoteStatus},
      peer: peerId1,
      peerClient: "Unknown",
    });
    await sleep(0);
    expect(libp2p.services.identify.identify).toHaveBeenCalledTimes(1);

    // Second status should NOT trigger identify again since agentVersion is already known
    networkEventBus.emit(NetworkEvent.reqRespRequest, {
      request: {method: ReqRespMethod.Status, body: remoteStatus},
      peer: peerId1,
      peerClient: "Unknown",
    });
    await sleep(0);
    expect(libp2p.services.identify.identify).toHaveBeenCalledTimes(1);

    const peerData = peerManager["connectedPeers"].get(peerId1.toString());
    expect(peerData?.agentVersion).toBe("Nimbus/v25.0.0");
    expect(peerData?.agentClient).toBe(ClientKind.Nimbus);
  });
});
