import {EventEmitter} from "node:events";
import {privateKeyFromRaw} from "@libp2p/crypto/keys";
import type {Connection, PeerId} from "@libp2p/interface";
import {multiaddr} from "@multiformats/multiaddr";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import type {LoggerNode} from "@lodestar/logger/node";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {getNodeApi} from "../../../../src/api/impl/node/index.js";
import type {ApiModules} from "../../../../src/api/impl/types.js";
import {defaultApiOptions} from "../../../../src/api/options.js";
import {Libp2pEvent} from "../../../../src/constants/index.js";
import {NetworkCore} from "../../../../src/network/core/networkCore.js";
import type {Discv5Worker} from "../../../../src/network/discv5/index.js";
import type {LodestarDiscv5Opts} from "../../../../src/network/discv5/types.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import type {Eth2Gossipsub} from "../../../../src/network/gossip/gossipsub.js";
import type {Libp2p} from "../../../../src/network/interface.js";
import type {NetworkConfig} from "../../../../src/network/networkConfig.js";
import {PeerDiscovery} from "../../../../src/network/peers/discover.js";
import {type IReqRespBeaconNodePeerManager, PeerManager} from "../../../../src/network/peers/peerManager.js";
import {PeersData} from "../../../../src/network/peers/peersData.js";
import {PeerRpcScoreStore} from "../../../../src/network/peers/score/index.js";
import {LocalStatusCache} from "../../../../src/network/statusCache.js";
import {type SubnetsService, computeNodeId} from "../../../../src/network/subnets/index.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

vi.mock("../../../../src/network/processor/gossipHandlers.js", () => ({getGossipHandlers: vi.fn()}));

const maxPeers = 10;
const maxDiscoveredEnrs = 11;

function createEnr(index: number): SignableENR {
  const keyBytes = new Uint8Array(32);
  new DataView(keyBytes.buffer).setUint32(28, index);
  const enr = SignableENR.createFromPrivateKey(privateKeyFromRaw(keyBytes));
  enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/tcp/9000"));
  return enr;
}

function createConnection(peerId: PeerId): Connection {
  return {
    direction: "inbound",
    status: "open",
    remotePeer: peerId,
    remoteAddr: multiaddr("/ip4/127.0.0.1/tcp/9000"),
  } as Connection;
}

describe("network / peers / PeerManager ENRs", () => {
  const managers: PeerManager[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    for (const manager of managers.splice(0)) await manager.close();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function setup(preOpenEnr?: SignableENR) {
    const localEnr = createEnr(1000);
    const libp2pEvents = new EventTarget();
    const connectionEvents = new EventTarget();
    const connections = new Map<string, {key: PeerId; value: Connection[]}>();
    const libp2p = {
      addEventListener: libp2pEvents.addEventListener.bind(libp2pEvents),
      removeEventListener: libp2pEvents.removeEventListener.bind(libp2pEvents),
      peerStore: {merge: vi.fn().mockResolvedValue(undefined)},
      services: {
        components: {
          events: connectionEvents,
          transportManager: {getTransports: () => [{[Symbol.toStringTag]: "@libp2p/tcp"}]},
          connectionManager: {getConnectionsMap: () => ({map: connections}), getDialQueue: () => []},
        },
      },
    } as unknown as Libp2p;
    const peersData = new PeersData();
    const discv5 = Object.assign(new EventEmitter(), {
      close: async () => {},
      kadValues: vi.fn<Discv5Worker["kadValues"]>().mockResolvedValue([]),
    });
    const networkConfig = {
      config: createBeaconConfig(config, new Uint8Array(32)),
      nodeId: computeNodeId(localEnr.peerId),
    } as NetworkConfig;
    const modules = {
      privateKey: privateKeyFromRaw(localEnr.privateKey),
      libp2p,
      networkConfig,
      clock: new ClockStopped(0),
      peerRpcScores: new PeerRpcScoreStore(),
      peersData,
      metrics: null,
      logger: getMockedLogger() as unknown as LoggerNode,
    };
    const discovery = new PeerDiscovery(
      modules,
      {
        maxPeers,
        discv5FirstQueryDelayMs: 0,
        discv5: {bootEnrs: []} as unknown as LodestarDiscv5Opts,
      },
      discv5 as unknown as Discv5Worker
    );
    vi.spyOn(discovery, "discoverPeers").mockImplementation(() => {});
    if (preOpenEnr) {
      discv5.emit("discovered", preOpenEnr.toENR());
      connections.set(preOpenEnr.peerId.toString(), {
        key: preOpenEnr.peerId,
        value: [createConnection(preOpenEnr.peerId)],
      });
    }
    const subnetsService = {getActiveSubnets: () => []} as unknown as SubnetsService;
    const manager = new PeerManager(
      {
        ...modules,
        events: new NetworkEventBus(),
        reqResp: {
          sendPing: vi.fn<IReqRespBeaconNodePeerManager["sendPing"]>(),
          sendStatus: vi.fn<IReqRespBeaconNodePeerManager["sendStatus"]>(),
          sendMetadata: vi.fn<IReqRespBeaconNodePeerManager["sendMetadata"]>(),
          sendGoodbye: vi.fn<IReqRespBeaconNodePeerManager["sendGoodbye"]>(),
        },
        gossip: {scoreParams: {}, isDirectPeer: () => false, getScore: () => 0} as unknown as Eth2Gossipsub,
        attnetsService: subnetsService,
        syncnetsService: subnetsService,
        statusCache: new LocalStatusCache(ssz.phase0.Status.defaultValue()),
      },
      {maxPeers, targetPeers: maxPeers, targetGroupPeers: 0, discv5: null},
      discovery
    );
    managers.push(manager);
    const networkCore = new NetworkCore({
      ...modules,
      config: networkConfig.config,
      peerManager: manager,
    } as unknown as ConstructorParameters<typeof NetworkCore>[0]);

    function connect(peerId: PeerId): Connection {
      const connection = createConnection(peerId);
      const existing = connections.get(peerId.toString())?.value ?? [];
      connections.set(peerId.toString(), {key: peerId, value: [...existing, connection]});
      connectionEvents.dispatchEvent(new CustomEvent(Libp2pEvent.connectionOpen, {detail: connection}));
      return connection;
    }

    function disconnect(connection: Connection): void {
      connection.status = "closed";
      connectionEvents.dispatchEvent(new CustomEvent(Libp2pEvent.connectionClose, {detail: connection}));
    }

    function discover(enr: SignableENR): void {
      discv5.emit("discovered", enr.toENR());
    }

    function churn(count = maxDiscoveredEnrs + 1): void {
      for (let index = 2; index < count + 2; index++) discover(createEnr(index));
    }

    return {
      manager,
      discovery,
      peersData,
      networkCore,
      discv5,
      logger: modules.logger,
      connect,
      disconnect,
      discover,
      churn,
    };
  }

  it("keeps a connected peer ENR in API responses after discovery cache eviction", async () => {
    const {networkCore, discover, connect, churn} = setup();
    const enr = createEnr(1);
    const peerIdStr = enr.peerId.toString();
    discover(enr);
    connect(enr.peerId);
    expect((await networkCore.dumpPeer(peerIdStr))?.enr).toBe(enr.encodeTxt());
    churn(251);

    expect((await networkCore.dumpPeer(peerIdStr))?.enr).toBe(enr.encodeTxt());
    expect((await networkCore.dumpPeers()).map((peer) => peer.enr)).toEqual([enr.encodeTxt()]);
  });

  it("refreshes discovery cache recency when a peer is rediscovered", () => {
    const {discovery, discover} = setup();
    const enrs = Array.from({length: maxDiscoveredEnrs + 1}, (_, index) => createEnr(index + 1));
    for (const enr of enrs.slice(0, maxDiscoveredEnrs)) discover(enr);
    discover(enrs[0]);
    discover(enrs[maxDiscoveredEnrs]);

    expect(discovery.getDiscoveredEnr(enrs[0].peerId.toString())).toBe(enrs[0].encodeTxt());
    expect(discovery.getDiscoveredEnr(enrs[1].peerId.toString())).toBeUndefined();
    expect(discovery.getDiscoveredEnr(enrs[maxDiscoveredEnrs].peerId.toString())).toBe(
      enrs[maxDiscoveredEnrs].encodeTxt()
    );
  });

  it("fills an unknown inbound peer ENR when discovered after connection", async () => {
    const {peersData, networkCore, connect, discover, churn} = setup();
    const enr = createEnr(1);
    const peerIdStr = enr.peerId.toString();
    connect(enr.peerId);
    expect(peersData.connectedPeers.get(peerIdStr)?.enr).toBeNull();
    expect((await networkCore.dumpPeer(peerIdStr))?.enr).toBeNull();

    discover(enr);
    churn();
    expect(peersData.connectedPeers.get(peerIdStr)?.enr).toBe(enr.encodeTxt());
    expect((await networkCore.dumpPeer(peerIdStr))?.enr).toBe(enr.encodeTxt());
  });

  it("retains the ENR across duplicate connections until the last connection closes", () => {
    const {peersData, connect, disconnect, discover, churn} = setup();
    const enr = createEnr(1);
    const peerIdStr = enr.peerId.toString();
    discover(enr);
    const first = connect(enr.peerId);
    churn();
    const second = connect(enr.peerId);
    expect(peersData.connectedPeers.get(peerIdStr)?.enr).toBe(enr.encodeTxt());

    disconnect(first);
    expect(peersData.connectedPeers.get(peerIdStr)?.enr).toBe(enr.encodeTxt());
    disconnect(second);
    expect(peersData.connectedPeers.has(peerIdStr)).toBe(false);

    connect(enr.peerId);
    expect(peersData.connectedPeers.get(peerIdStr)?.enr).toBeNull();
  });

  it("copies discovered ENRs when bootstrapping already open connections", () => {
    const enr = createEnr(1);
    const {discovery, peersData, churn} = setup(enr);
    churn();

    expect(discovery.getDiscoveredEnr(enr.peerId.toString())).toBeUndefined();
    expect(peersData.connectedPeers.get(enr.peerId.toString())?.enr).toBe(enr.encodeTxt());
  });

  it("hydrates a missing ENR on the heartbeat and retains it after it leaves the routing table", async () => {
    const {manager, networkCore, discv5, connect} = setup();
    const enr = createEnr(1);
    const peerIdStr = enr.peerId.toString();
    connect(enr.peerId);
    discv5.kadValues.mockResolvedValueOnce([enr.toENR()]);
    expect((await networkCore.dumpPeer(peerIdStr))?.enr).toBeNull();
    expect(discv5.kadValues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect((await networkCore.dumpPeer(peerIdStr))?.enr).toBe(enr.encodeTxt());
    manager.onCommitteeSubscriptions();
    expect((await networkCore.dumpPeers()).map((peer) => peer.enr)).toEqual([enr.encodeTxt()]);
    expect(discv5.kadValues).toHaveBeenCalledOnce();
  });

  it("returns peer snapshots and counts without querying KAD", async () => {
    const {networkCore, discv5, connect} = setup();
    const enr = createEnr(1);
    connect(enr.peerId);
    discv5.kadValues.mockResolvedValue([enr.toENR()]);
    const api = getNodeApi(defaultApiOptions, {network: networkCore} as unknown as Pick<
      ApiModules,
      "network" | "sync" | "chain"
    >);

    expect((await networkCore.dumpPeer(enr.peerId.toString()))?.enr).toBeNull();
    expect((await networkCore.dumpPeers()).map((peer) => peer.enr)).toEqual([null]);
    expect(await api.getPeerCount()).toEqual({
      data: {disconnected: 0, connecting: 0, connected: 1, disconnecting: 0},
    });
    expect(discv5.kadValues).not.toHaveBeenCalled();
  });

  it("skips KAD when no connected peer is missing an ENR", async () => {
    const {manager, discv5, discover, connect, disconnect} = setup();
    manager.onCommitteeSubscriptions();
    const enr = createEnr(1);
    discover(enr);
    const connection = connect(enr.peerId);
    manager.onCommitteeSubscriptions();
    disconnect(connection);
    manager.onCommitteeSubscriptions();
    await Promise.resolve();

    expect(discv5.kadValues).not.toHaveBeenCalled();
  });

  it("preserves connected ENRs when KAD rejects and retries on the next heartbeat", async () => {
    const {manager, networkCore, discv5, logger, discover, connect, churn} = setup();
    const known = createEnr(1);
    const missing = createEnr(50);
    discover(known);
    connect(known.peerId);
    connect(missing.peerId);
    churn();
    const error = new Error("discv5 stopped");
    discv5.kadValues.mockRejectedValueOnce(error);
    manager.onCommitteeSubscriptions();
    await Promise.resolve();

    expect((await networkCore.dumpPeer(known.peerId.toString()))?.enr).toBe(known.encodeTxt());
    expect((await networkCore.dumpPeer(missing.peerId.toString()))?.enr).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith("Could not update peer ENRs from discv5 kadValues", {}, error);

    discv5.kadValues.mockResolvedValueOnce([missing.toENR()]);
    manager.onCommitteeSubscriptions();
    await Promise.resolve();
    expect((await networkCore.dumpPeer(missing.peerId.toString()))?.enr).toBe(missing.encodeTxt());
    expect(discv5.kadValues).toHaveBeenCalledTimes(2);
  });

  it("does not restore disconnected peer data when a pending KAD lookup resolves", async () => {
    const {manager, networkCore, peersData, discv5, connect, disconnect} = setup();
    const enr = createEnr(1);
    const peerIdStr = enr.peerId.toString();
    const connection = connect(enr.peerId);
    const lookup = defer<Awaited<ReturnType<Discv5Worker["kadValues"]>>>();
    discv5.kadValues.mockReturnValueOnce(lookup.promise);
    manager.onCommitteeSubscriptions();
    expect(discv5.kadValues).toHaveBeenCalledOnce();

    disconnect(connection);
    lookup.resolve([enr.toENR()]);
    await Promise.resolve();

    expect(await networkCore.dumpPeer(peerIdStr)).toMatchObject({enr: null, state: "disconnected"});
    expect(peersData.connectedPeers.has(peerIdStr)).toBe(false);
  });

  it("does not overwrite an ENR discovered while a KAD lookup is pending", async () => {
    const {manager, peersData, discv5, connect, discover} = setup();
    const enr = createEnr(1);
    connect(enr.peerId);
    const oldEnr = enr.toENR();
    const lookup = defer<Awaited<ReturnType<Discv5Worker["kadValues"]>>>();
    discv5.kadValues.mockReturnValueOnce(lookup.promise);
    manager.onCommitteeSubscriptions();

    enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/tcp/9001"));
    discover(enr);
    lookup.resolve([oldEnr]);
    await Promise.resolve();

    expect(peersData.connectedPeers.get(enr.peerId.toString())?.enr).toBe(enr.encodeTxt());
  });

  it("coalesces pending KAD lookups and retries missing peers on a later heartbeat", async () => {
    const {manager, peersData, discv5, connect} = setup();
    const enr = createEnr(1);
    connect(enr.peerId);
    const lookup = defer<Awaited<ReturnType<Discv5Worker["kadValues"]>>>();
    discv5.kadValues.mockReturnValueOnce(lookup.promise);
    manager.onCommitteeSubscriptions();
    manager.onCommitteeSubscriptions();
    expect(discv5.kadValues).toHaveBeenCalledOnce();

    lookup.resolve([]);
    await Promise.resolve();
    discv5.kadValues.mockResolvedValueOnce([enr.toENR()]);
    manager.onCommitteeSubscriptions();
    await Promise.resolve();

    expect(peersData.connectedPeers.get(enr.peerId.toString())?.enr).toBe(enr.encodeTxt());
    expect(discv5.kadValues).toHaveBeenCalledTimes(2);
  });
});
