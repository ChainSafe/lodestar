import {Connection, PrivateKey} from "@libp2p/interface";
import {multiaddr} from "@multiformats/multiaddr";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/dist/src/score/peer-score.js";
import {ENR} from "@chainsafe/enr";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import type {LoggerNode} from "@lodestar/logger/node";
import {Epoch, phase0} from "@lodestar/types";
import {fromHex, withTimeout} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {ResponseIncoming} from "@lodestar/reqresp";
import {Libp2p} from "../interface.js";
import {PeerManager} from "../peers/peerManager.js";
import {ReqRespBeaconNode} from "../reqresp/ReqRespBeaconNode.js";
import {OutgoingRequestArgs, GetReqRespHandlerFn} from "../reqresp/types.js";
import {Eth2Gossipsub, getCoreTopicsAtFork} from "../gossip/index.js";
import {SyncnetsService} from "../subnets/syncnetsService.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForks} from "../forks.js";
import {NetworkOptions} from "../options.js";
import {CommitteeSubscription, IAttnetsService} from "../subnets/interface.js";
import {MetadataController} from "../metadata.js";
import {createNodeJsLibp2p} from "../libp2p/index.js";
import {PeersData} from "../peers/peersData.js";
import {PeerAction, PeerRpcScoreStore, PeerScoreStats} from "../peers/index.js";
import {getConnectionsMap} from "../util.js";
import {IClock, ClockEvent} from "../../util/clock.js";
import {formatNodePeer} from "../../api/impl/node/utils.js";
import {NetworkEventBus} from "../events.js";
import {Discv5Worker} from "../discv5/index.js";
import {LocalStatusCache} from "../statusCache.js";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {peerIdFromString, peerIdToString} from "../../util/peerId.js";
import {AttnetsService} from "../subnets/attnetsService.js";
import {NetworkCoreMetrics, createNetworkCoreMetrics} from "./metrics.js";
import {INetworkCore, MultiaddrStr, PeerIdStr} from "./types.js";

type Mods = {
  libp2p: Libp2p;
  gossip: Eth2Gossipsub;
  reqResp: ReqRespBeaconNode;
  attnetsService: IAttnetsService;
  syncnetsService: SyncnetsService;
  peerManager: PeerManager;
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
  initialStatus: phase0.Status;
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
  private readonly subscribedForks = new Set<ForkName>();
  private closed = false;

  constructor(modules: Mods) {
    this.libp2p = modules.libp2p;
    this.gossip = modules.gossip;
    this.reqResp = modules.reqResp;
    this.attnetsService = modules.attnetsService;
    this.syncnetsService = modules.syncnetsService;
    this.peerManager = modules.peerManager;
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
    const peerRpcScores = new PeerRpcScoreStore(opts, metrics);
    const statusCache = new LocalStatusCache(initialStatus);

    // Bind discv5's ENR to local metadata
    // resolve circular dependency by setting `discv5` variable after the peer manager is instantiated
    // biome-ignore lint/style/useConst: <explanation>
    let discv5: Discv5Worker | undefined;
    const onMetadataSetValue = function onMetadataSetValue(key: string, value: Uint8Array): void {
      discv5?.setEnrValue(key, value).catch((e) => logger.error("error on setEnrValue", {key}, e));
    };
    const metadata = new MetadataController({}, {config, onSetValue: onMetadataSetValue});

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

    const enr = opts.discv5?.enr;
    const nodeId = enr ? fromHex(ENR.decodeTxt(enr).nodeId) : null;
    const attnetsService = new AttnetsService(config, clock, gossip, metadata, logger, metrics, nodeId, opts);
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
        config,
        peerRpcScores,
        events,
        peersData,
        statusCache,
      },
      opts
    );

    // Network spec decides version changes based on clock fork, not head fork
    const forkCurrentSlot = config.getForkName(clock.currentSlot);
    // Register only ReqResp protocols relevant to clock's fork
    reqResp.registerProtocolsAtFork(forkCurrentSlot);

    // Bind discv5's ENR to local metadata
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
    // In some cases, `libp2p.stop` never resolves, it is required
    // to wrap the call with a timeout to allow for a timely shutdown
    // See https://github.com/ChainSafe/lodestar/issues/6053
    await withTimeout(async () => this.libp2p.stop(), 5000);
    this.logger.debug("network lib2p closed");

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    return [
      (await this.metrics?.register.metrics()) ?? "",
      (await this.peerManager["discovery"]?.discv5.scrapeMetrics()) ?? "",
    ]
      .filter((str) => str.length > 0)
      .join("\n\n");
  }

  async updateStatus(status: phase0.Status): Promise<void> {
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

  async isSubscribedToGossipCoreTopics(): Promise<boolean> {
    return this.subscribedForks.size > 0;
  }

  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming> {
    const peerId = peerIdFromString(data.peerId);
    return this.reqResp.sendRequestWithoutEncoding(peerId, data.method, data.versions, data.requestData);
  }
  async publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts | undefined): Promise<number> {
    const {recipients} = await this.gossip.publish(topic, data, opts);
    return recipients.length;
  }

  // REST API queries

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
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
    return this.peerManager.dumpPeerScoreStats();
  }

  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.gossip.dumpPeerScoreStats();
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
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
    return this.peerManager["discovery"]?.discv5.writeProfile(durationMs, dirpath) ?? "no discv5";
  }

  writeNetworkHeapSnapshot(): Promise<string> {
    throw new Error("Method not implemented, please configure network thread");
  }

  writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.peerManager["discovery"]?.discv5.writeHeapSnapshot(prefix, dirpath) ?? Promise.resolve("no discv5");
  }

  /**
   * Handle subscriptions through fork transitions, @see FORK_EPOCH_LOOKAHEAD
   */
  private onEpoch = async (epoch: Epoch): Promise<void> => {
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
            if (await this.isSubscribedToGossipCoreTopics()) {
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

      // TODO: Re-add regossipCachedBlsChanges()
      // If we are subscribed and post capella fork epoch, try gossiping the cached bls changes
      // if (
      //   this.isSubscribedToGossipCoreTopics() &&
      //   epoch >= this.config.CAPELLA_FORK_EPOCH &&
      //   !this.regossipBlsChangesPromise
      // ) {
      //   this.regossipBlsChangesPromise = this.regossipCachedBlsChanges()
      //     // If the processing fails for e.g. because of lack of peers set the promise
      //     // to be null again to be retried
      //     .catch((_e) => {
      //       this.regossipBlsChangesPromise = null;
      //     });
      // }
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e as Error);
    }
  };

  private subscribeCoreTopicsAtFork(fork: ForkName): void {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);
    const {subscribeAllSubnets, disableLightClientServer} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {
      subscribeAllSubnets,
      disableLightClientServer,
    })) {
      this.gossip.subscribeTopic({...topic, fork});
    }
  }

  private unsubscribeCoreTopicsAtFork(fork: ForkName): void {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);
    const {subscribeAllSubnets, disableLightClientServer} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {
      subscribeAllSubnets,
      disableLightClientServer,
    })) {
      this.gossip.unsubscribeTopic({...topic, fork});
    }
  }
}
