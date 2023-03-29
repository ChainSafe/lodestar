import {Connection} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {Epoch, phase0} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {formatNodePeer} from "../../api/impl/node/utils.js";
import {NetworkOptions} from "../options.js";
import {Libp2p} from "../interface.js";
import {Eth2Gossipsub, getCoreTopicsAtFork, GossipTopic, PublisherBeaconNode} from "../gossip/index.js";
import {MetadataController} from "../metadata.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForks} from "../forks.js";
import {PeerManager} from "../peers/peerManager.js";
import {IPeerRpcScoreStore, PeerAction, PeerRpcScoreStore, PeerScoreStats} from "../peers/index.js";
import {INetworkEventBus, NetworkEventBus} from "../events.js";
import {AttnetsService, CommitteeSubscription, SyncnetsService} from "../subnets/index.js";
import {PeersData} from "../peers/peersData.js";
import {getConnectionsMap} from "../util.js";
import {createNodeJsLibp2p} from "../nodejs/util.js";
import {ReqRespBeaconNode, ReqRespHandlers} from "../reqresp/index.js";
import {GossipPublisher} from "../gossip/publisher.js";
import {ClockEvent, EventedBeaconClock} from "../../chain/clock/interface.js";
import {LocalStatusCache} from "../statusCache.js";
import {INetworkCore} from "./types.js";
import {createNetworkCoreMetrics, NetworkCoreMetrics} from "./metrics.js";

type NetworkCoreModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  clock: EventedBeaconClock;
  statusCache: LocalStatusCache;
  peersData: PeersData;
  events: NetworkEventBus;
  metadata: MetadataController;
  peerRpcScores: PeerRpcScoreStore;
  reqResp: ReqRespBeaconNode;
  gossip: PublisherBeaconNode;
  rawGossip: Eth2Gossipsub;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  peerManager: PeerManager;
  metrics: NetworkCoreMetrics | null;
};

export type NetworkCoreInitModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  peerId: PeerId;
  peerStoreDir?: string;
  logger: Logger;
  events: NetworkEventBus;
  metricsRegistry: RegistryMetricCreator | null;
  clock: EventedBeaconClock;
  reqRespHandlers: ReqRespHandlers;
  activeValidatorCount: number;
  initialStatus: phase0.Status;
};

export class NetworkCore implements INetworkCore {
  readonly gossip: PublisherBeaconNode;
  readonly rawGossip: Eth2Gossipsub;
  readonly reqResp: ReqRespBeaconNode;
  readonly events: INetworkEventBus;

  private readonly attnetsService: AttnetsService;
  private readonly syncnetsService: SyncnetsService;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly opts: NetworkOptions;
  private readonly peersData: PeersData;
  private readonly metadata: MetadataController;
  private readonly peerManager: PeerManager;
  private readonly libp2p: Libp2p;
  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly clock: EventedBeaconClock;
  private readonly statusCache: LocalStatusCache;
  private readonly metrics: NetworkCoreMetrics | null;

  private subscribedForks = new Set<ForkName>();
  private closed = false;

  constructor(modules: NetworkCoreModules) {
    const {
      opts,
      config,
      libp2p,
      logger,
      clock,
      statusCache,
      peersData,
      events,
      metadata,
      peerRpcScores,
      reqResp,
      gossip,
      rawGossip,
      attnetsService,
      syncnetsService,
      peerManager,
      metrics,
    } = modules;
    this.gossip = gossip;
    this.rawGossip = rawGossip;
    this.reqResp = reqResp;
    this.opts = opts;
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.clock = clock;
    this.statusCache = statusCache;
    this.peersData = peersData;
    this.events = events;
    this.metadata = metadata;
    this.peerRpcScores = peerRpcScores;
    this.attnetsService = attnetsService;
    this.syncnetsService = syncnetsService;
    this.peerManager = peerManager;
    this.metrics = metrics;

    this.clock.on(ClockEvent.epoch, this.onEpoch);
  }

  static async init({
    opts,
    config,
    logger,
    metricsRegistry,
    events,
    peerId,
    peerStoreDir,
    clock,
    reqRespHandlers,
    activeValidatorCount,
    initialStatus,
  }: NetworkCoreInitModules): Promise<NetworkCore> {
    const libp2p = await createNodeJsLibp2p(peerId, opts, {
      peerStoreDir: peerStoreDir,
      metrics: Boolean(metricsRegistry),
      metricsRegistry: metricsRegistry ?? undefined,
    });

    const metrics = metricsRegistry ? createNetworkCoreMetrics(metricsRegistry) : null;
    const peersData = new PeersData();
    const metadata = new MetadataController({}, {config, clock, logger});
    const peerRpcScores = new PeerRpcScoreStore(metrics);
    const statusCache = new LocalStatusCache(initialStatus);

    const reqResp = new ReqRespBeaconNode(
      {
        config,
        libp2p,
        reqRespHandlers,
        metadata,
        peerRpcScores,
        logger,
        events,
        metrics,
        peersData,
      },
      opts
    );

    // resolve the circular dependency between getGossipHandlers and attnetsService
    // eslint-disable-next-line prefer-const
    let rawGossip: Eth2Gossipsub;

    const _gossip = {
      subscribeTopic(topic: GossipTopic): void {
        rawGossip.subscribeTopic(topic);
      },
      unsubscribeTopic(topic: GossipTopic): void {
        rawGossip.unsubscribeTopic(topic);
      },
    };

    const attnetsService = new AttnetsService(config, clock, _gossip, metadata, logger, metrics, opts);

    rawGossip = new Eth2Gossipsub(opts, {
      config,
      libp2p,
      logger,
      metrics,
      eth2Context: {
        activeValidatorCount,
        currentSlot: clock.currentSlot,
        currentEpoch: clock.currentEpoch,
      },
      peersData,
      events,
      attnetsService,
    });

    const gossip = new GossipPublisher({config, logger, publishGossip: rawGossip.publish.bind(rawGossip)});

    const syncnetsService = new SyncnetsService(config, clock, rawGossip, metadata, logger, metrics, opts);

    const peerManager = new PeerManager(
      {
        libp2p,
        reqResp,
        gossip: rawGossip,
        attnetsService,
        syncnetsService,
        logger,
        metrics,
        statusCache,
        clock,
        config,
        peerRpcScores,
        networkEventBus: events,
        peersData,
      },
      opts
    );

    await libp2p.start();

    // Network spec decides version changes based on clock fork, not head fork
    const forkCurrentSlot = config.getForkName(clock.currentSlot);

    // Register only ReqResp protocols relevant to clock's fork
    await reqResp.start();
    reqResp.registerProtocolsAtFork(forkCurrentSlot);

    await peerManager.start();
    const discv5 = peerManager["discovery"]?.discv5;
    const setEnrValue = discv5?.setEnrValue.bind(discv5);
    // Initialize ENR with clock's fork
    metadata.start(setEnrValue, config.getForkName(clock.currentSlot));
    await rawGossip.start();
    attnetsService.start();
    syncnetsService.start();

    return new NetworkCore({
      opts,
      config,
      libp2p,
      logger,
      clock,
      statusCache,
      peersData,
      events,
      metadata,
      peerRpcScores,
      reqResp,
      gossip,
      rawGossip,
      attnetsService,
      syncnetsService,
      peerManager,
      metrics,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.clock.off(ClockEvent.epoch, this.onEpoch);

    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    await this.peerManager.stop();
    await this.rawGossip.stop();

    await this.reqResp.stop();
    await this.reqResp.unregisterAllProtocols();

    this.attnetsService.stop();
    this.syncnetsService.stop();
    await this.libp2p.stop();

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    return (
      await Promise.all([
        async () => (await this.metrics?.register.metrics()) ?? "",
        async () => (await this.peerManager["discovery"]?.discv5?.metrics()) ?? "",
      ])
    ).join("\n\n");
  }

  async updateStatus(status: phase0.Status): Promise<void> {
    this.statusCache.update(status);
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

  async hasAttachedSyncCommitteeMember(): Promise<boolean> {
    return this.syncnetsService.getActiveSubnets().length > 0;
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  async reStatusPeers(peers: PeerId[]): Promise<void> {
    this.peerManager.reStatusPeers(peers);
  }

  async reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void> {
    this.peerRpcScores.applyAction(peer, action, actionName);
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  async subscribeGossipCoreTopics(): Promise<void> {
    if (!this.isSubscribedToGossipCoreTopics()) {
      this.logger.info("Subscribed gossip core topics");
    }

    for (const fork of getActiveForks(this.config, this.clock.currentEpoch)) {
      this.subscribeCoreTopicsAtFork(fork);
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  async unsubscribeGossipCoreTopics(): Promise<void> {
    for (const fork of this.subscribedForks.values()) {
      this.unsubscribeCoreTopicsAtFork(fork);
    }
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.subscribedForks.size > 0;
  }

  // REST API queries

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    const enr = await this.peerManager["discovery"]?.discv5.enr();
    const discoveryAddresses = [
      enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
      enr?.getLocationMultiaddr("udp")?.toString() ?? null,
    ].filter((addr): addr is string => Boolean(addr));

    return {
      peerId: this.libp2p.peerId.toString(),
      enr: enr?.encodeTxt() || "",
      discoveryAddresses,
      p2pAddresses: this.libp2p.getMultiaddrs().map((m) => m.toString()),
      metadata: this.metadata.json,
    };
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    return getConnectionsMap(this.libp2p.connectionManager);
  }

  async getConnectedPeers(): Promise<PeerId[]> {
    return this.peerManager.getConnectedPeerIds();
  }

  async getConnectedPeerCount(): Promise<number> {
    return this.peerManager.getConnectedPeerIds().length;
  }

  // Debug

  async connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    await this.libp2p.peerStore.addressBook.add(peer, multiaddr);
    await this.libp2p.dial(peer);
  }

  async disconnectPeer(peer: PeerId): Promise<void> {
    await this.libp2p.hangUp(peer);
  }

  async dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const connections = this.getConnectionsByPeer().get(peerIdStr);
    return connections
      ? {...formatNodePeer(peerIdStr, connections), agentVersion: this.peersData.getAgentVersion(peerIdStr)}
      : undefined;
  }

  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return Array.from(this.getConnectionsByPeer().entries()).map(([peerIdStr, connections]) => ({
      ...formatNodePeer(peerIdStr, connections),
      agentVersion: this.peersData.getAgentVersion(peerIdStr),
    }));
  }

  async dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.peerRpcScores.dumpPeerScoreStats();
  }

  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.rawGossip.dumpPeerScoreStats();
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
    return (await this.peerManager["discovery"]?.discv5?.kadValues())?.map((enr) => enr.encodeTxt()) ?? [];
  }

  async dumpMeshPeers(): Promise<Record<string, string[]>> {
    const meshPeers: Record<string, string[]> = {};
    for (const topic of this.rawGossip.getTopics()) {
      meshPeers[topic] = this.rawGossip.getMeshPeers(topic);
    }
    return meshPeers;
  }

  async dumpENR(): Promise<string | undefined> {
    return (await this.peerManager["discovery"]?.discv5.enr())?.encodeTxt();
  }

  /**
   * Handle subscriptions through fork transitions, @see FORK_EPOCH_LOOKAHEAD
   */
  private onEpoch = (epoch: Epoch): void => {
    try {
      // Compute prev and next fork shifted, so next fork is still next at forkEpoch + FORK_EPOCH_LOOKAHEAD
      const activeForks = getActiveForks(this.config, epoch);
      for (let i = 0; i < activeForks.length; i++) {
        // Only when a new fork is scheduled post this one
        if (activeForks[i + 1]) {
          const prevFork = activeForks[i];
          const nextFork = activeForks[i + 1];
          const forkEpoch = this.config.forks[nextFork].epoch;

          // Before fork transition
          if (epoch === forkEpoch - FORK_EPOCH_LOOKAHEAD) {
            // Don't subscribe to new fork if the node is not subscribed to any topic
            if (this.isSubscribedToGossipCoreTopics()) {
              this.subscribeCoreTopicsAtFork(nextFork);
              this.logger.info("Subscribing gossip topics before fork", {nextFork});
            } else {
              this.logger.info("Skipping subscribing gossip topics before fork", {nextFork});
            }
            this.attnetsService.subscribeSubnetsToNextFork(nextFork);
            this.syncnetsService.subscribeSubnetsToNextFork(nextFork);
          }

          // On fork transition
          if (epoch === forkEpoch) {
            // updateEth2Field() MUST be called with clock epoch, onEpoch event is emitted in response to clock events
            this.metadata.updateEth2Field(epoch);
            this.reqResp.registerProtocolsAtFork(nextFork);
          }

          // After fork transition
          if (epoch === forkEpoch + FORK_EPOCH_LOOKAHEAD) {
            this.logger.info("Unsubscribing gossip topics from prev fork", {prevFork});
            this.unsubscribeCoreTopicsAtFork(prevFork);
            this.attnetsService.unsubscribeSubnetsFromPrevFork(prevFork);
            this.syncnetsService.unsubscribeSubnetsFromPrevFork(prevFork);
          }
        }
      }
    } catch (e) {
      this.logger.error("Error on NetworkCore.onEpoch", {epoch}, e as Error);
    }
  };

  private subscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.rawGossip.subscribeTopic({...topic, fork});
    }
  };

  private unsubscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.rawGossip.unsubscribeTopic({...topic, fork});
    }
  };
}
