import {Connection} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {BeaconConfig} from "@lodestar/config";
import {Logger, sleep, toHex} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {computeEpochAtSlot, computeTimeAtSlot} from "@lodestar/state-transition";
import {Epoch, phase0, allForks} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {Metrics} from "../metrics/index.js";
import {ClockEvent, IClock} from "../util/clock.js";
import {IBeaconChain} from "../chain/index.js";
import {BlockInput} from "../chain/blocks/types.js";
import {isValidBlsToExecutionChangeForBlockInclusion} from "../chain/opPools/utils.js";
import {formatNodePeer} from "../api/impl/node/utils.js";
import {NetworkOptions} from "./options.js";
import {INetwork, Libp2p} from "./interface.js";
import {ReqRespBeaconNode, ReqRespHandlers, beaconBlocksMaybeBlobsByRange} from "./reqresp/index.js";
import {beaconBlocksMaybeBlobsByRoot} from "./reqresp/beaconBlocksMaybeBlobsByRoot.js";
import {Eth2Gossipsub, GossipHandlers, GossipType, getCoreTopicsAtFork, GossipTopic} from "./gossip/index.js";
import {MetadataController} from "./metadata.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForks} from "./forks.js";
import {PeerManager} from "./peers/peerManager.js";
import {IPeerRpcScoreStore, PeerAction, PeerRpcScoreStore, PeerScoreStats} from "./peers/index.js";
import {INetworkEventBus, NetworkEventBus} from "./events.js";
import {AttnetsService, CommitteeSubscription, SyncnetsService} from "./subnets/index.js";
import {PeersData} from "./peers/peersData.js";
import {getConnectionsMap, isPublishToZeroPeersError} from "./util.js";
import {Discv5Worker} from "./discv5/index.js";
import {createNodeJsLibp2p} from "./nodejs/util.js";
import {NetworkProcessor} from "./processor/index.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {createNetworkCoreMetrics} from "./core/metrics.js";
import {GossipPublisher} from "./gossip/publisher.js";
import {LocalStatusCache} from "./statusCache.js";

// How many changes to batch cleanup
const CACHED_BLS_BATCH_CLEANUP_LIMIT = 10;

type NetworkModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  chain: IBeaconChain;
  signal: AbortSignal;
  peersData: PeersData;
  networkEventBus: NetworkEventBus;
  networkProcessor: NetworkProcessor;
  metadata: MetadataController;
  peerRpcScores: PeerRpcScoreStore;
  reqResp: ReqRespBeaconNode;
  gossip: Eth2Gossipsub;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  peerManager: PeerManager;
  statusCache: LocalStatusCache;
};

export type NetworkInitModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  peerId: PeerId;
  peerStoreDir?: string;
  logger: Logger;
  metrics: Metrics | null;
  chain: IBeaconChain;
  reqRespHandlers: ReqRespHandlers;
  signal: AbortSignal;
  // Optionally pass custom GossipHandlers, for testing
  gossipHandlers?: GossipHandlers;
};

export class Network implements INetwork {
  events: INetworkEventBus;
  reqResp: ReqRespBeaconNode;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  gossip: GossipPublisher;
  metadata: MetadataController;
  readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly opts: NetworkOptions;
  private readonly peersData: PeersData;

  private readonly networkProcessor: NetworkProcessor;
  private readonly peerManager: PeerManager;
  private readonly statusCache: LocalStatusCache;
  private readonly libp2p: Libp2p;
  private readonly gossipsub: Eth2Gossipsub;
  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly clock: IClock;
  private readonly chain: IBeaconChain;
  private readonly signal: AbortSignal;

  private subscribedForks = new Set<ForkName>();
  private regossipBlsChangesPromise: Promise<void> | null = null;
  private closed = false;

  constructor(modules: NetworkModules) {
    const {
      opts,
      config,
      libp2p,
      logger,
      chain,
      signal,
      peersData,
      networkEventBus,
      networkProcessor,
      metadata,
      peerRpcScores,
      reqResp,
      gossip,
      attnetsService,
      syncnetsService,
      peerManager,
      statusCache,
    } = modules;
    this.opts = opts;
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.chain = chain;
    this.clock = chain.clock;
    this.signal = signal;
    this.peersData = peersData;
    this.events = networkEventBus;
    (this.networkProcessor = networkProcessor), (this.metadata = metadata);
    this.peerRpcScores = peerRpcScores;
    this.reqResp = reqResp;
    this.gossipsub = gossip;
    this.gossip = new GossipPublisher({config, logger, publishGossip: gossip.publish.bind(gossip)});
    this.attnetsService = attnetsService;
    this.syncnetsService = syncnetsService;
    this.peerManager = peerManager;
    this.statusCache = statusCache;

    this.chain.clock.on(ClockEvent.epoch, this.onEpoch);
    this.chain.emitter.on(routes.events.EventType.head, this.onHead);
    this.chain.emitter.on(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.on(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    modules.signal.addEventListener("abort", this.close.bind(this), {once: true});
  }

  static async init({
    opts,
    config,
    logger,
    metrics,
    peerId,
    peerStoreDir,
    chain,
    reqRespHandlers,
    signal,
    gossipHandlers,
  }: NetworkInitModules): Promise<Network> {
    const clock = chain.clock;
    const metricsCore = metrics && createNetworkCoreMetrics(metrics.register);
    const peersData = new PeersData();
    const networkEventBus = new NetworkEventBus();
    const metadata = new MetadataController(config);
    const peerRpcScores = new PeerRpcScoreStore(metricsCore);

    const libp2p = await createNodeJsLibp2p(peerId, opts, {
      peerStoreDir: peerStoreDir,
      metrics: Boolean(metrics),
      metricsRegistry: metrics?.register,
    });

    const reqResp = new ReqRespBeaconNode(
      {
        config,
        libp2p,
        reqRespHandlers,
        metadata,
        peerRpcScores,
        logger,
        networkEventBus,
        metrics: metricsCore,
        peersData,
      },
      opts
    );

    // resolve the circular dependency between getGossipHandlers and attnetsService
    // eslint-disable-next-line prefer-const
    let gossip: Eth2Gossipsub;

    const _gossip = {
      subscribeTopic(topic: GossipTopic): void {
        gossip.subscribeTopic(topic);
      },
      unsubscribeTopic(topic: GossipTopic): void {
        gossip.unsubscribeTopic(topic);
      },
    };

    const attnetsService = new AttnetsService(config, chain.clock, _gossip, metadata, logger, metricsCore, opts);

    gossip = new Eth2Gossipsub(opts, {
      config,
      libp2p,
      logger,
      metrics: metricsCore,
      eth2Context: {
        activeValidatorCount: chain.getHeadState().epochCtx.currentShuffling.activeIndices.length,
        currentSlot: clock.currentSlot,
        currentEpoch: clock.currentEpoch,
      },
      peersData,
      events: networkEventBus,
    });

    const syncnetsService = new SyncnetsService(config, chain.clock, gossip, metadata, logger, metricsCore, opts);

    const statusCache = new LocalStatusCache(chain.getStatus());
    const peerManager = new PeerManager(
      {
        libp2p,
        reqResp,
        gossip,
        attnetsService,
        syncnetsService,
        logger,
        metrics: metricsCore,
        clock,
        statusCache,
        config,
        peerRpcScores,
        networkEventBus,
        peersData,
      },
      opts
    );

    const networkProcessor = new NetworkProcessor(
      {attnetsService, chain, config, logger, metrics, peerRpcScores, events: networkEventBus, gossipHandlers},
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
    metadata.start(setEnrValue, clock.currentEpoch);
    await gossip.start();
    attnetsService.start();
    syncnetsService.start();
    const multiaddresses = libp2p
      .getMultiaddrs()
      .map((m) => m.toString())
      .join(",");
    logger.info(`PeerId ${libp2p.peerId.toString()}, Multiaddrs ${multiaddresses}`);

    return new Network({
      opts,
      config,
      libp2p,
      logger,
      chain,
      signal,
      peersData,
      networkEventBus,
      networkProcessor,
      metadata,
      peerRpcScores,
      reqResp,
      gossip,
      attnetsService,
      syncnetsService,
      peerManager,
      statusCache,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.chain.emitter.off(ClockEvent.epoch, this.onEpoch);
    this.chain.emitter.off(routes.events.EventType.head, this.onHead);
    this.chain.emitter.off(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);

    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    await this.peerManager.stop();
    await this.gossipsub.stop();

    await this.reqResp.stop();
    await this.reqResp.unregisterAllProtocols();

    this.attnetsService.stop();
    this.syncnetsService.stop();
    await this.libp2p.stop();

    this.closed = true;
  }

  async metrics(): Promise<string> {
    return (await this.discv5?.metrics()) ?? "";
  }

  get discv5(): Discv5Worker | undefined {
    return this.peerManager["discovery"]?.discv5;
  }

  get localMultiaddrs(): Multiaddr[] {
    return this.libp2p.getMultiaddrs();
  }

  get peerId(): PeerId {
    return this.libp2p.peerId;
  }

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    const enr = await this.peerManager["discovery"]?.discv5.enr();
    const discoveryAddresses = [
      enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
      enr?.getLocationMultiaddr("udp")?.toString() ?? null,
    ].filter((addr): addr is string => Boolean(addr));

    return {
      peerId: this.peerId.toString(),
      enr: enr?.encodeTxt() || "",
      discoveryAddresses,
      p2pAddresses: this.localMultiaddrs.map((m) => m.toString()),
      metadata: {
        seqNumber: this.metadata.seqNumber,
        attnets: this.metadata.attnets,
        syncnets: this.metadata.syncnets,
      },
    };
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    return getConnectionsMap(this.libp2p.connectionManager);
  }

  getConnectedPeers(): PeerId[] {
    return this.peerManager.getConnectedPeerIds();
  }

  getConnectedPeerCount(): number {
    return this.peerManager.getConnectedPeerIds().length;
  }

  async beaconBlocksMaybeBlobsByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<BlockInput[]> {
    return beaconBlocksMaybeBlobsByRange(this.config, this.reqResp, peerId, request, this.clock.currentEpoch);
  }

  async beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]> {
    return beaconBlocksMaybeBlobsByRoot(
      this.config,
      this.reqResp,
      peerId,
      request,
      this.clock.currentSlot,
      this.chain.forkChoice.getFinalizedBlock().slot
    );
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  async prepareBeaconCommitteeSubnet(subscriptions: CommitteeSubscription[]): Promise<void> {
    this.attnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    this.syncnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
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

    const currentEpoch = computeEpochAtSlot(this.chain.forkChoice.getHead().slot);
    for (const fork of getActiveForks(this.config, currentEpoch)) {
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

    // Drop all the gossip validation queues
    this.networkProcessor.dropAllJobs();
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.subscribedForks.size > 0;
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
    return this.gossipsub.dumpPeerScoreStats();
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
    return (await this.discv5?.kadValues())?.map((enr) => enr.encodeTxt()) ?? [];
  }

  async dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]> {
    return this.networkProcessor.dumpGossipQueue(gossipType);
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
        if (activeForks[i + 1] !== undefined) {
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
            const enrForkId = this.metadata.updateEth2Field(epoch);
            if (enrForkId) this.logger.verbose(`Updated ENR.eth2: ${toHex(enrForkId)}`);
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

      // If we are subscribed and post capella fork epoch, try gossiping the cached bls changes
      if (
        this.isSubscribedToGossipCoreTopics() &&
        epoch >= this.config.CAPELLA_FORK_EPOCH &&
        !this.regossipBlsChangesPromise
      ) {
        this.regossipBlsChangesPromise = this.regossipCachedBlsChanges()
          // If the processing fails for e.g. because of lack of peers set the promise
          // to be null again to be retried
          .catch((_e) => {
            this.regossipBlsChangesPromise = null;
          });
      }
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e as Error);
    }
  };

  private onHead = (): void => {
    this.statusCache.update(this.chain.getStatus());
  };

  private subscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.gossipsub.subscribeTopic({...topic, fork});
    }
  };

  private unsubscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.gossipsub.unsubscribeTopic({...topic, fork});
    }
  };

  private async regossipCachedBlsChanges(): Promise<void> {
    let gossipedIndexes = [];
    let includedIndexes = [];
    let totalProcessed = 0;

    this.logger.debug("Re-gossiping unsubmitted cached bls changes");
    try {
      const headState = this.chain.getHeadState();
      for (const poolData of this.chain.opPool.getAllBlsToExecutionChanges()) {
        const {data: value, preCapella} = poolData;
        if (preCapella) {
          if (isValidBlsToExecutionChangeForBlockInclusion(headState, value)) {
            await this.gossip.publishBlsToExecutionChange(value);
            gossipedIndexes.push(value.message.validatorIndex);
          } else {
            // No need to gossip if its already been in the headState
            // TODO: Should use final state?
            includedIndexes.push(value.message.validatorIndex);
          }

          this.chain.opPool.insertBlsToExecutionChange(value, false);
          totalProcessed += 1;

          // Cleanup in small batches
          if (totalProcessed % CACHED_BLS_BATCH_CLEANUP_LIMIT === 0) {
            this.logger.debug("Gossiped cached blsChanges", {
              gossipedIndexes: `${gossipedIndexes}`,
              includedIndexes: `${includedIndexes}`,
              totalProcessed,
            });
            gossipedIndexes = [];
            includedIndexes = [];
          }
        }
      }

      // Log any remaining changes
      if (totalProcessed % CACHED_BLS_BATCH_CLEANUP_LIMIT !== 0) {
        this.logger.debug("Gossiped cached blsChanges", {
          gossipedIndexes: `${gossipedIndexes}`,
          includedIndexes: `${includedIndexes}`,
          totalProcessed,
        });
      }
    } catch (e) {
      this.logger.error("Failed to completely gossip unsubmitted cached bls changes", {totalProcessed}, e as Error);
      // Throw error so that the promise can be set null to be retied
      throw e;
    }
    if (totalProcessed > 0) {
      this.logger.info("Regossiped unsubmitted blsChanges", {totalProcessed});
    } else {
      this.logger.debug("No unsubmitted blsChanges to gossip", {totalProcessed});
    }
  }

  private onLightClientFinalityUpdate = async (finalityUpdate: allForks.LightClientFinalityUpdate): Promise<void> => {
    if (this.hasAttachedSyncCommitteeMember()) {
      try {
        // messages SHOULD be broadcast after one-third of slot has transpired
        // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
        await this.waitOneThirdOfSlot(finalityUpdate.signatureSlot);
        await this.gossip.publishLightClientFinalityUpdate(finalityUpdate);
      } catch (e) {
        // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
        // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
        if (!isPublishToZeroPeersError(e as Error)) {
          this.logger.debug("Error on BeaconGossipHandler.onLightclientFinalityUpdate", {}, e as Error);
        }
      }
    }
  };

  private onLightClientOptimisticUpdate = async (
    optimisticUpdate: allForks.LightClientOptimisticUpdate
  ): Promise<void> => {
    if (this.hasAttachedSyncCommitteeMember()) {
      try {
        // messages SHOULD be broadcast after one-third of slot has transpired
        // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
        await this.waitOneThirdOfSlot(optimisticUpdate.signatureSlot);
        await this.gossip.publishLightClientOptimisticUpdate(optimisticUpdate);
      } catch (e) {
        // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
        // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
        if (!isPublishToZeroPeersError(e as Error)) {
          this.logger.debug("Error on BeaconGossipHandler.onLightclientOptimisticUpdate", {}, e as Error);
        }
      }
    }
  };

  private waitOneThirdOfSlot = async (slot: number): Promise<void> => {
    const secAtSlot = computeTimeAtSlot(this.config, slot + 1 / 3, this.chain.genesisTime);
    const msToSlot = secAtSlot * 1000 - Date.now();
    await sleep(msToSlot, this.signal);
  };

  // full nodes with at least one validator assigned to the current sync committee at the block's slot SHOULD broadcast
  // This prevents flooding the network by restricting full nodes that initially
  // publish to at most 512 (max size of active sync committee).
  // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
  private hasAttachedSyncCommitteeMember(): boolean {
    return this.syncnetsService.getActiveSubnets().length > 0;
  }
}
