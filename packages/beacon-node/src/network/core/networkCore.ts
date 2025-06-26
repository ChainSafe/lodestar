import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/dist/src/score/peer-score.js";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {Connection, PrivateKey} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import type {LoggerNode} from "@lodestar/logger/node";
import {ResponseIncoming} from "@lodestar/reqresp";
import {Epoch, Status, sszTypesFor} from "@lodestar/types";
import {multiaddr} from "@multiformats/multiaddr";
import {formatNodePeer} from "../../api/impl/node/utils.js";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import {PeerIdStr, peerIdFromString, peerIdToString} from "../../util/peerId.js";
import {Discv5Worker} from "../discv5/index.js";
import {NetworkEventBus} from "../events.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveSubscribeBoundaries} from "../forks.js";
import {Eth2Gossipsub, getCoreTopicsAtFork} from "../gossip/index.js";
import {Libp2p} from "../interface.js";
import {createNodeJsLibp2p} from "../libp2p/index.js";
import {MetadataController} from "../metadata.js";
import {NetworkConfig} from "../networkConfig.js";
import {NetworkOptions} from "../options.js";
import {PeerAction, PeerRpcScoreStore, PeerScoreStats} from "../peers/index.js";
import {PeerManager} from "../peers/peerManager.js";
import {PeersData} from "../peers/peersData.js";
import {ReqRespBeaconNode} from "../reqresp/ReqRespBeaconNode.js";
import {GetReqRespHandlerFn, OutgoingRequestArgs} from "../reqresp/types.js";
import {LocalStatusCache} from "../statusCache.js";
import {AttnetsService} from "../subnets/attnetsService.js";
import {CommitteeSubscription, IAttnetsService} from "../subnets/interface.js";
import {SyncnetsService} from "../subnets/syncnetsService.js";
import {getConnectionsMap} from "../util.js";
import {NetworkCoreMetrics, createNetworkCoreMetrics} from "./metrics.js";
import {INetworkCore, MultiaddrStr, SubscribeBoundary} from "./types.js";

type Mods = {
  libp2p: Libp2p;
  gossip: Eth2Gossipsub;
  reqResp: ReqRespBeaconNode;
  attnetsService: IAttnetsService;
  syncnetsService: SyncnetsService;
  peerManager: PeerManager;
  networkConfig: NetworkConfig;
  peersData: PeersData;
  metadata: MetadataController;
  logger: LoggerNode;
  config: BeaconConfig;
  clock: IClock;
  statusCache: LocalStatusCache;
  metrics: NetworkCoreMetrics | null;
  opts: NetworkOptions;
};

export type BaseNetworkInit = {
  opts: NetworkOptions;
  config: BeaconConfig;
  privateKey: PrivateKey;
  peerStoreDir: string | undefined;
  logger: LoggerNode;
  metricsRegistry: RegistryMetricCreator | null;
  clock: IClock;
  events: NetworkEventBus;
  getReqRespHandler: GetReqRespHandlerFn;
  activeValidatorCount: number;
  initialStatus: Status;
};

/**
 * This class is meant to work both:
 * - In a libp2p worker
 * - In the main thread
 *
 * libp2p holds the reference to the TCP transport socket. libp2p is in a worker, what components
 * must be in a worker too?
 * - MetadataController: Read by ReqRespBeaconNode, written by AttnetsService + SyncnetsService
 * - PeerRpcScoreStore
 * - ReqRespBeaconNode: Must be in worker, depends on libp2p
 * - Eth2Gossipsub: Must be in worker, depends on libp2p
 * - AttnetsService
 * - SyncnetsService
 * - PeerManager
 * - NetworkProcessor: Must be in the main thread, depends on chain
 */
export class NetworkCore implements INetworkCore {
  // Internal modules
  private readonly libp2p: Libp2p;
  private readonly attnetsService: IAttnetsService;
  private readonly syncnetsService: SyncnetsService;
  private readonly peerManager: PeerManager;
  private readonly networkConfig: NetworkConfig;
  private readonly peersData: PeersData;
  private readonly reqResp: ReqRespBeaconNode;
  private readonly gossip: Eth2Gossipsub;
  // TODO: Review if here is best place, and best architecture
  private readonly metadata: MetadataController;
  private readonly logger: LoggerNode;
  private readonly config: BeaconConfig;
  private readonly clock: IClock;
  private readonly statusCache: LocalStatusCache;
  private readonly metrics: NetworkCoreMetrics | null;
  private readonly opts: NetworkOptions;

  // Internal state
  private readonly subscribedBoundariesByEpoch = new Map<Epoch, SubscribeBoundary>();
  private closed = false;

  constructor(modules: Mods) {
    this.libp2p = modules.libp2p;
    this.gossip = modules.gossip;
    this.reqResp = modules.reqResp;
    this.attnetsService = modules.attnetsService;
    this.syncnetsService = modules.syncnetsService;
    this.peerManager = modules.peerManager;
    this.networkConfig = modules.networkConfig;
    this.peersData = modules.peersData;
    this.metadata = modules.metadata;
    this.logger = modules.logger;
    this.config = modules.config;
    this.clock = modules.clock;
    this.statusCache = modules.statusCache;
    this.metrics = modules.metrics;
    this.opts = modules.opts;

    this.clock.on(ClockEvent.epoch, this.onEpoch);
  }

  static async init({
    opts,
    config,
    privateKey,
    peerStoreDir,
    logger,
    metricsRegistry,
    events,
    clock,
    getReqRespHandler,
    activeValidatorCount,
    initialStatus,
  }: BaseNetworkInit): Promise<NetworkCore> {
    const libp2p = await createNodeJsLibp2p(privateKey, opts, {
      peerStoreDir,
      metrics: Boolean(metricsRegistry),
      metricsRegistry: metricsRegistry ?? undefined,
    });

    const metrics = metricsRegistry ? createNetworkCoreMetrics(metricsRegistry) : null;
    const peersData = new PeersData();
    const peerRpcScores = new PeerRpcScoreStore(opts, metrics, logger);
    const statusCache = new LocalStatusCache(initialStatus);

    // Bind discv5's ENR to local metadata
    // resolve circular dependency by setting `discv5` variable after the peer manager is instantiated
    // biome-ignore lint/style/useConst: <explanation>
    let discv5: Discv5Worker | undefined;
    const onMetadataSetValue = function onMetadataSetValue(key: string, value: Uint8Array): void {
      discv5?.setEnrValue(key, value).catch((e) => logger.error("error on setEnrValue", {key}, e));
    };
    const peerId = peerIdFromPrivateKey(privateKey);
    const networkConfig = new NetworkConfig(peerId, config);
    const metadata = new MetadataController({}, {networkConfig, onSetValue: onMetadataSetValue});

    const reqResp = new ReqRespBeaconNode(
      {
        config,
        libp2p,
        metadata,
        peerRpcScores,
        logger,
        events,
        metrics,
        peersData,
        statusCache,
        getHandler: getReqRespHandler,
      },
      opts
    );

    const gossip = new Eth2Gossipsub(opts, {
      config,
      libp2p,
      logger,
      metricsRegister: metricsRegistry,
      eth2Context: {
        activeValidatorCount,
        currentSlot: clock.currentSlot,
        currentEpoch: clock.currentEpoch,
      },
      peersData,
      events,
    });

    // Note: should not be necessary, already called in createNodeJsLibp2p()
    await libp2p.start();

    await reqResp.start();
    // should be called before AttnetsService constructor so that node subscribe to deterministic attnet topics
    await gossip.start();

    const attnetsService = new AttnetsService(
      config,
      clock,
      gossip,
      metadata,
      logger,
      metrics,
      networkConfig.getNodeId(),
      opts
    );
    const syncnetsService = new SyncnetsService(config, clock, gossip, metadata, logger, metrics, opts);

    const peerManager = await PeerManager.init(
      {
        privateKey,
        libp2p,
        gossip,
        reqResp,
        attnetsService,
        syncnetsService,
        logger,
        metrics,
        clock,
        peerRpcScores,
        events,
        networkConfig: networkConfig,
        peersData,
        statusCache,
      },
      opts
    );

    // Network spec decides version changes based on clock fork, not head fork
    const forkCurrentSlot = config.getForkName(clock.currentSlot);

    // Register only ReqResp protocols relevant to clock's fork
    reqResp.registerProtocolsAtBoundary({fork: forkCurrentSlot});

    // Bind discv5's ENR to local metadata
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    discv5 = peerManager["discovery"]?.discv5;

    // Initialize ENR with clock's fork
    metadata.upstreamValues(clock.currentEpoch);

    return new NetworkCore({
      libp2p,
      reqResp,
      gossip,
      attnetsService,
      syncnetsService,
      peerManager,
      networkConfig: networkConfig,
      peersData,
      metadata,
      logger,
      config,
      clock,
      statusCache,
      metrics,
      opts,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.clock.off(ClockEvent.epoch, this.onEpoch);

    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    this.logger.debug("network sent goodbye to all peers");
    await this.peerManager.close();
    this.logger.debug("network peerManager closed");
    await this.gossip.stop();
    this.logger.debug("network gossip closed");
    await this.reqResp.stop();
    await this.reqResp.unregisterAllProtocols();
    this.logger.debug("network reqResp closed");
    this.attnetsService.close();
    this.syncnetsService.close();
    await this.libp2p.stop();
    this.logger.debug("network lib2p closed");

    this.closed = true;
  }

  getNetworkConfig(): NetworkConfig {
    return this.networkConfig;
  }

  async scrapeMetrics(): Promise<string> {
    return [
      (await this.metrics?.register.metrics()) ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
      (await this.peerManager["discovery"]?.discv5.scrapeMetrics()) ?? "",
    ]
      .filter((str) => str.length > 0)
      .join("\n\n");
  }

  async updateStatus(status: Status): Promise<void> {
    this.statusCache.update(status);
  }

  async reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): Promise<void> {
    this.peerManager.reportPeer(peerIdFromString(peer), action, actionName);
  }

  async reStatusPeers(peers: PeerIdStr[]): Promise<void> {
    this.peerManager.reStatusPeers(peers);
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    this.attnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    this.syncnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  async subscribeGossipCoreTopics(): Promise<void> {
    if (!(await this.isSubscribedToGossipCoreTopics())) {
      this.logger.info("Subscribed gossip core topics");
    }

    for (const boundary of getActiveSubscribeBoundaries(this.config, this.clock.currentEpoch)) {
      this.subscribeCoreTopicsAtBoundary(this.config, boundary);
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  async unsubscribeGossipCoreTopics(): Promise<void> {
    for (const boundary of this.subscribedBoundariesByEpoch.values()) {
      this.unsubscribeCoreTopicsAtBoundary(this.config, boundary);
    }
  }

  async isSubscribedToGossipCoreTopics(): Promise<boolean> {
    return this.subscribedBoundariesByEpoch.size > 0;
  }

  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming> {
    const peerId = peerIdFromString(data.peerId);
    return this.reqResp.sendRequestWithoutEncoding(peerId, data.method, data.versions, data.requestData);
  }

  async publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts | undefined): Promise<number> {
    const {recipients} = await this.gossip.publish(topic, data, opts);
    return recipients.length;
  }

  async setTargetGroupCount(count: number): Promise<void> {
    this.networkConfig.setTargetGroupCount(count);
  }

  async setAdvertisedGroupCount(count: number): Promise<void> {
    this.networkConfig.setAdvertisedGroupCount(count);
    this.metadata.custodyGroupCount = count;
  }

  // REST API queries

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    const enr = await this.peerManager["discovery"]?.discv5.enr();
    const discoveryAddresses = [
      enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
      enr?.getLocationMultiaddr("udp")?.toString() ?? null,
    ].filter((addr): addr is string => Boolean(addr));

    return {
      peerId: peerIdToString(this.libp2p.peerId),
      enr: enr?.encodeTxt() || "",
      discoveryAddresses,
      p2pAddresses: this.libp2p.getMultiaddrs().map((m) => m.toString()),
      metadata: this.metadata.json,
    };
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    const m = new Map<string, Connection[]>();
    for (const [k, v] of getConnectionsMap(this.libp2p).entries()) {
      m.set(k, v.value);
    }
    return m;
  }

  async getConnectedPeers(): Promise<PeerIdStr[]> {
    return this.peerManager.getConnectedPeerIds().map(peerIdToString);
  }

  async getConnectedPeerCount(): Promise<number> {
    return this.peerManager.getConnectedPeerIds().length;
  }

  // Debug

  async connectToPeer(peerIdStr: PeerIdStr, multiaddrStrArr: MultiaddrStr[]): Promise<void> {
    const peer = peerIdFromString(peerIdStr);
    await this.libp2p.peerStore.merge(peer, {multiaddrs: multiaddrStrArr.map(multiaddr)});
    await this.libp2p.dial(peer);
  }

  async disconnectPeer(peerIdStr: PeerIdStr): Promise<void> {
    await this.libp2p.hangUp(peerIdFromString(peerIdStr));
  }

  private _dumpPeer(peerIdStr: string, connections: Connection[]): routes.lodestar.LodestarNodePeer {
    const peerData = this.peersData.connectedPeers.get(peerIdStr);
    const fork = this.config.getForkName(this.clock.currentSlot);
    return {
      ...formatNodePeer(peerIdStr, connections),
      status: peerData?.status ? sszTypesFor(fork).Status.toJson(peerData.status) : null,
      agentVersion: peerData?.agentVersion ?? "NA",
      metadata: peerData?.metadata ? sszTypesFor(fork).Metadata.toJson(peerData.metadata) : null,
      agentClient: String(peerData?.agentClient ?? "Unknown"),
      lastReceivedMsgUnixTsMs: peerData?.lastReceivedMsgUnixTsMs ?? 0,
      lastStatusUnixTsMs: peerData?.lastStatusUnixTsMs ?? 0,
      connectedUnixTsMs: peerData?.connectedUnixTsMs ?? 0,
    };
  }

  async dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const connections = this.getConnectionsByPeer().get(peerIdStr);
    return connections ? this._dumpPeer(peerIdStr, connections) : undefined;
  }

  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return Array.from(this.getConnectionsByPeer().entries()).map(([peerIdStr, connections]) =>
      this._dumpPeer(peerIdStr, connections)
    );
  }

  async dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.peerManager.dumpPeerScoreStats();
  }

  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.gossip.dumpPeerScoreStats();
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    return (await this.peerManager["discovery"]?.discv5?.kadValues())?.map((enr) => enr.encodeTxt()) ?? [];
  }

  async dumpMeshPeers(): Promise<Record<string, string[]>> {
    const meshPeers: Record<string, string[]> = {};
    for (const topic of this.gossip.getTopics()) {
      meshPeers[topic] = this.gossip.getMeshPeers(topic);
    }
    return meshPeers;
  }

  async writeNetworkThreadProfile(): Promise<string> {
    throw new Error("Method not implemented, please configure network thread");
  }

  async writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    return this.peerManager["discovery"]?.discv5.writeProfile(durationMs, dirpath) ?? "no discv5";
  }

  writeNetworkHeapSnapshot(): Promise<string> {
    throw new Error("Method not implemented, please configure network thread");
  }

  writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    return this.peerManager["discovery"]?.discv5.writeHeapSnapshot(prefix, dirpath) ?? Promise.resolve("no discv5");
  }

  /**
   * Handle subscriptions through subscribe boundary transitions, @see FORK_EPOCH_LOOKAHEAD
   */
  private onEpoch = async (epoch: Epoch): Promise<void> => {
    try {
      // Compute prev and next fork shifted, so next fork is still next at forkEpoch + FORK_EPOCH_LOOKAHEAD
      const activeBoundaries = getActiveSubscribeBoundaries(this.config, epoch);
      for (let i = 0; i < activeBoundaries.length; i++) {
        // Only when a new subscribe boundary is scheduled post this one
        if (activeBoundaries[i + 1] !== undefined) {
          const prevBoundary = activeBoundaries[i];
          const nextBoundary = activeBoundaries[i + 1];
          const nextBoundaryEpoch = this.config.forks[nextBoundary.fork].epoch;

          // Before subscribe boundary transition
          if (epoch === nextBoundaryEpoch - FORK_EPOCH_LOOKAHEAD) {
            // Don't subscribe to new boundary if the node is not subscribed to any topic
            if (await this.isSubscribedToGossipCoreTopics()) {
              this.subscribeCoreTopicsAtBoundary(this.config, nextBoundary);
              this.logger.info("Subscribing gossip topics before boundary", nextBoundary);
            } else {
              this.logger.info("Skipping subscribing gossip topics before boundary", nextBoundary);
            }
            this.attnetsService.subscribeSubnetsAfterBoundary(nextBoundary);
            this.syncnetsService.subscribeSubnetsAfterBoundary(nextBoundary);
          }

          // On boundary transition
          if (epoch === nextBoundaryEpoch) {
            // updateEth2Field() MUST be called with clock epoch, onEpoch event is emitted in response to clock events
            this.metadata.updateEth2Field(epoch);
            this.reqResp.registerProtocolsAtBoundary(nextBoundary);
          }

          // After boundary transition
          if (epoch === nextBoundaryEpoch + FORK_EPOCH_LOOKAHEAD) {
            this.logger.info("Unsubscribing gossip topics before boundary", prevBoundary);
            this.unsubscribeCoreTopicsAtBoundary(this.config, prevBoundary);
            this.attnetsService.unsubscribeSubnetsBeforeBoundary(prevBoundary);
            this.syncnetsService.unsubscribeSubnetsBeforeBoundary(prevBoundary);
          }
        }
      }
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e as Error);
    }
  };

  private subscribeCoreTopicsAtBoundary(config: BeaconConfig, boundary: SubscribeBoundary): void {
    const epoch = config.forks[boundary.fork].epoch;
    if (this.subscribedBoundariesByEpoch.has(epoch)) return;
    this.subscribedBoundariesByEpoch.set(epoch, boundary);
    const {subscribeAllSubnets, disableLightClientServer} = this.opts;

    for (const topic of getCoreTopicsAtFork(config, boundary.fork, {
      subscribeAllSubnets,
      disableLightClientServer,
    })) {
      this.gossip.subscribeTopic({...topic, boundary});
    }
  }

  private unsubscribeCoreTopicsAtBoundary(config: BeaconConfig, boundary: SubscribeBoundary): void {
    const epoch = config.forks[boundary.fork].epoch;
    if (!this.subscribedBoundariesByEpoch.has(epoch)) return;
    this.subscribedBoundariesByEpoch.delete(epoch);
    const {subscribeAllSubnets, disableLightClientServer} = this.opts;

    for (const topic of getCoreTopicsAtFork(config, boundary.fork, {
      subscribeAllSubnets,
      disableLightClientServer,
    })) {
      this.gossip.unsubscribeTopic({...topic, boundary});
    }
  }
}
