import {PeerId} from "@libp2p/interface-peer-id";
import {multiaddr, Multiaddr} from "@multiformats/multiaddr";
import {PeerIdStr} from "@chainsafe/libp2p-gossipsub/types";
import {BeaconConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {Epoch, phase0, allForks} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {Metrics, RegistryMetricCreator} from "../metrics/index.js";
import {ChainEvent, IBeaconChain} from "../chain/index.js";
import {BlockInput} from "../chain/blocks/types.js";
import {isValidBlsToExecutionChangeForBlockInclusion} from "../chain/opPools/utils.js";
import {EventedBeaconClock} from "../chain/clock/interface.js";
import {NetworkOptions} from "./options.js";
import {INetwork} from "./interface.js";
import {ReqRespHandlers, beaconBlocksMaybeBlobsByRange, IReqRespBeaconNode} from "./reqresp/index.js";
import {beaconBlocksMaybeBlobsByRoot} from "./reqresp/beaconBlocksMaybeBlobsByRoot.js";
import {GossipHandlers, GossipType, PublisherBeaconNode} from "./gossip/index.js";
import {PeerAction, PeerScoreStats} from "./peers/index.js";
import {INetworkEventBus, NetworkEvent, NetworkEventBus} from "./events.js";
import {CommitteeSubscription, SimpleAttnetsService, SimpleAttnetsServiceState} from "./subnets/index.js";
import {isPublishToZeroPeersError} from "./util.js";
import {NetworkProcessor} from "./processor/index.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {INetworkCore, NetworkCore} from "./core/index.js";

// How many changes to batch cleanup
const CACHED_BLS_BATCH_CLEANUP_LIMIT = 10;

type NetworkModules = {
  peerId: PeerId;
  localMultiaddrs: Multiaddr[];
  opts: NetworkOptions;
  config: BeaconConfig;
  logger: Logger;
  chain: IBeaconChain;
  attnetsService: SimpleAttnetsService;
  metrics: Metrics | null;
  core: INetworkCore;
  signal: AbortSignal;
  events: NetworkEventBus;
  networkProcessor: NetworkProcessor;
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
  readonly peerId: PeerId;
  readonly localMultiaddrs: Multiaddr[];
  readonly events: INetworkEventBus;
  readonly reqResp: IReqRespBeaconNode;
  readonly gossip: PublisherBeaconNode;
  private readonly core: INetworkCore;
  private readonly opts: NetworkOptions;
  private readonly networkProcessor: NetworkProcessor;
  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly attnetsService: SimpleAttnetsService;
  private readonly signal: AbortSignal;

  private connectedPeers = new Map<PeerIdStr, PeerId>();
  private subscribedToCoreTopics = false;
  private regossipBlsChangesPromise: Promise<void> | null = null;
  private closed = false;

  constructor(modules: NetworkModules) {
    const {
      peerId,
      localMultiaddrs,
      opts,
      config,
      logger,
      metrics,
      core,
      chain,
      signal,
      events,
      networkProcessor,
      attnetsService,
    } = modules;
    this.peerId = peerId;
    this.localMultiaddrs = localMultiaddrs;
    this.opts = opts;
    this.config = config;
    this.logger = logger;
    this.chain = chain;
    this.attnetsService = attnetsService;
    this.signal = signal;
    this.events = events;
    this.networkProcessor = networkProcessor;
    this.core = core;
    this.reqResp = core.reqResp;
    this.gossip = core.gossip;

    metrics?.peers.addCollect(() => metrics.peers.set(this.getConnectedPeerCount()));
    this.chain.emitter.on(ChainEvent.clockEpoch, this.onEpoch);
    this.chain.emitter.on(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.on(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    this.events.on(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    this.events.on(NetworkEvent.attnetSubscriptionChange, this.onAttnetSubscriptionChange);
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
    const events = new NetworkEventBus();
    const activeValidatorCount = chain.getHeadState().epochCtx.currentShuffling.activeIndices.length;
    const initialStatus = chain.getStatus();
    const metricsRegistry = metrics ? new RegistryMetricCreator() : null;
    const clock = chain.clock as EventedBeaconClock;
    const attnetsService = new SimpleAttnetsService();
    const core = await NetworkCore.init({
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
    });
    const networkProcessor = new NetworkProcessor(
      {
        chain,
        config,
        logger,
        metrics,
        reportPeer: core.reportPeer.bind(core),
        events,
        gossipHandlers,
        shouldProcessAttestation: attnetsService.shouldProcess.bind(attnetsService),
      },
      opts
    );

    const {p2pAddresses} = await core.getNetworkIdentity();
    const multiaddresses = p2pAddresses.join(",");
    logger.info(`PeerId ${peerId.toString()}, Multiaddrs ${multiaddresses}`);

    return new Network({
      peerId,
      localMultiaddrs: p2pAddresses.map(multiaddr),
      opts,
      config,
      logger,
      metrics,
      chain,
      attnetsService,
      core,
      signal,
      events,
      networkProcessor,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.chain.emitter.off(ChainEvent.clockEpoch, this.onEpoch);
    this.chain.emitter.off(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    this.events.off(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnected);

    await this.core.close();

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    return this.core.scrapeMetrics();
  }

  getConnectedPeers(): PeerId[] {
    return Array.from(this.connectedPeers.values());
  }
  getConnectedPeerCount(): number {
    return this.connectedPeers.size;
  }

  async beaconBlocksMaybeBlobsByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<BlockInput[]> {
    return beaconBlocksMaybeBlobsByRange(this.config, this.reqResp, peerId, request, this.chain.clock.currentEpoch);
  }

  async beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]> {
    return beaconBlocksMaybeBlobsByRoot(
      this.config,
      this.reqResp,
      peerId,
      request,
      this.chain.clock.currentSlot,
      this.chain.forkChoice.getFinalizedBlock().slot
    );
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.core.prepareBeaconCommitteeSubnets(subscriptions);
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.core.prepareSyncCommitteeSubnets(subscriptions);
  }

  async hasAttachedSyncCommitteeMember(): Promise<boolean> {
    return this.core.hasAttachedSyncCommitteeMember();
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  async reStatusPeers(peers: PeerId[]): Promise<void> {
    return this.core.reStatusPeers(peers);
  }

  async reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void> {
    return this.core.reportPeer(peer, action, actionName);
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  async subscribeGossipCoreTopics(): Promise<void> {
    if (!this.subscribedToCoreTopics) {
      await this.core.subscribeGossipCoreTopics();
      // Only mark subscribedToCoreTopics if worker resolved this call
      this.subscribedToCoreTopics = true;
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  async unsubscribeGossipCoreTopics(): Promise<void> {
    if (this.subscribedToCoreTopics) {
      // Drop all the gossip validation queues
      this.networkProcessor.dropAllJobs();

      await this.core.unsubscribeGossipCoreTopics();
      // Only mark subscribedToCoreTopics if worker resolved this call
      this.subscribedToCoreTopics = false;
    }
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.subscribedToCoreTopics;
  }

  shouldProcessAttestation(subnet: number, slot: number): boolean {
    return this.attnetsService.shouldProcess(subnet, slot);
  }

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.core.getNetworkIdentity();
  }

  async connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.core.connectToPeer(peer, multiaddr);
  }

  async disconnectPeer(peer: PeerId): Promise<void> {
    return this.core.disconnectPeer(peer);
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
    return this.core.dumpDiscv5KadValues();
  }

  async dumpENR(): Promise<string | undefined> {
    return this.core.dumpENR();
  }

  async dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.core.dumpMeshPeers();
  }

  async dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.core.dumpPeer(peerIdStr);
  }

  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.core.dumpPeers();
  }

  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.core.dumpGossipPeerScoreStats();
  }

  async dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.core.dumpPeerScoreStats();
  }

  async dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]> {
    return this.networkProcessor.dumpGossipQueue(gossipType);
  }

  /**
   * Handle subscriptions through fork transitions, @see FORK_EPOCH_LOOKAHEAD
   */
  private onEpoch = (epoch: Epoch): void => {
    try {
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
      this.logger.error("Error on Network.onEpoch", {epoch}, e as Error);
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
    if (await this.core.hasAttachedSyncCommitteeMember()) {
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
    if (await this.core.hasAttachedSyncCommitteeMember()) {
      try {
        // messages SHOULD be broadcast after one-third of slot has transpired
        // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
        await this.waitOneThirdOfSlot(optimisticUpdate.signatureSlot);
        await this.gossip.publishLightClientOptimisticUpdate(optimisticUpdate);
      } catch (e) {
        // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
        // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
        if (!isPublishToZeroPeersError(e as Error)) {
          this.logger.debug("Error on Network.onLightclientOptimisticUpdate", {}, e as Error);
        }
      }
    }
  };

  private onPeerConnected = (peerId: PeerId): void => {
    this.connectedPeers.set(peerId.toString(), peerId);
  };

  private onPeerDisconnected = (peerId: PeerId): void => {
    this.connectedPeers.delete(peerId.toString());
  };

  private onAttnetSubscriptionChange = (state: SimpleAttnetsServiceState): void => {
    this.attnetsService.updateState(state);
  };

  private waitOneThirdOfSlot = async (slot: number): Promise<void> => {
    const secAtSlot = computeTimeAtSlot(this.config, slot + 1 / 3, this.chain.genesisTime);
    const msToSlot = secAtSlot * 1000 - Date.now();
    await sleep(msToSlot, this.signal);
  };
}
