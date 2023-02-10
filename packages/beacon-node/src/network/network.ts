import {Connection} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {IBeaconConfig} from "@lodestar/config";
import {ILogger, sleep} from "@lodestar/utils";
import {ATTESTATION_SUBNET_COUNT, ForkName, ForkSeq, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {SignableENR} from "@chainsafe/discv5";
import {computeEpochAtSlot, computeTimeAtSlot} from "@lodestar/state-transition";
import {deneb, Epoch, phase0, allForks} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {IMetrics} from "../metrics/index.js";
import {ChainEvent, IBeaconChain, IBeaconClock} from "../chain/index.js";
import {BlockInput, BlockInputType, getBlockInput} from "../chain/blocks/types.js";
import {isValidBlsToExecutionChangeForBlockInclusion} from "../chain/opPools/utils.js";
import {INetworkOptions} from "./options.js";
import {INetwork, Libp2p} from "./interface.js";
import {ReqRespBeaconNode, ReqRespHandlers, doBeaconBlocksMaybeBlobsByRange} from "./reqresp/index.js";
import {
  Eth2Gossipsub,
  getGossipHandlers,
  GossipHandlers,
  GossipTopicTypeMap,
  GossipType,
  getCoreTopicsAtFork,
} from "./gossip/index.js";
import {MetadataController} from "./metadata.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForks} from "./forks.js";
import {PeerManager} from "./peers/peerManager.js";
import {IPeerRpcScoreStore, PeerAction, PeerRpcScoreStore} from "./peers/index.js";
import {INetworkEventBus, NetworkEventBus} from "./events.js";
import {AttnetsService, CommitteeSubscription, SyncnetsService} from "./subnets/index.js";
import {PeersData} from "./peers/peersData.js";
import {getConnectionsMap, isPublishToZeroPeersError} from "./util.js";
import {Discv5Worker} from "./discv5/index.js";

// How many changes to batch cleanup
const CACHED_BLS_BATCH_CLEANUP_LIMIT = 10;

interface INetworkModules {
  config: IBeaconConfig;
  libp2p: Libp2p;
  logger: ILogger;
  metrics: IMetrics | null;
  chain: IBeaconChain;
  reqRespHandlers: ReqRespHandlers;
  signal: AbortSignal;
  // Optionally pass custom GossipHandlers, for testing
  gossipHandlers?: GossipHandlers;
}

export class Network implements INetwork {
  events: INetworkEventBus;
  reqResp: ReqRespBeaconNode;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
  readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly peersData: PeersData;

  private readonly peerManager: PeerManager;
  private readonly libp2p: Libp2p;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;
  private readonly clock: IBeaconClock;
  private readonly chain: IBeaconChain;
  private readonly signal: AbortSignal;

  private subscribedForks = new Set<ForkName>();
  private regossipBlsChangesPromise: Promise<void> | null = null;

  constructor(private readonly opts: INetworkOptions, modules: INetworkModules) {
    const {config, libp2p, logger, metrics, chain, reqRespHandlers, gossipHandlers, signal} = modules;
    this.libp2p = libp2p;
    this.logger = logger;
    this.config = config;
    this.signal = signal;
    this.clock = chain.clock;
    this.chain = chain;
    this.peersData = new PeersData();
    const networkEventBus = new NetworkEventBus();
    const metadata = new MetadataController({}, {config, chain, logger});
    const peerRpcScores = new PeerRpcScoreStore(metrics);
    this.events = networkEventBus;
    this.metadata = metadata;
    this.peerRpcScores = peerRpcScores;
    this.reqResp = new ReqRespBeaconNode(
      {
        config,
        libp2p,
        reqRespHandlers,
        metadata,
        peerRpcScores,
        logger,
        networkEventBus,
        metrics,
        peersData: this.peersData,
      },
      opts
    );

    this.gossip = new Eth2Gossipsub(opts, {
      config,
      libp2p,
      logger,
      metrics,
      signal,
      gossipHandlers: gossipHandlers ?? getGossipHandlers({chain, config, logger, network: this, metrics}, opts),
      eth2Context: {
        activeValidatorCount: chain.getHeadState().epochCtx.currentShuffling.activeIndices.length,
        currentSlot: this.clock.currentSlot,
        currentEpoch: this.clock.currentEpoch,
      },
      peersData: this.peersData,
    });

    this.attnetsService = new AttnetsService(config, chain, this.gossip, metadata, logger, metrics, opts);
    this.syncnetsService = new SyncnetsService(config, chain, this.gossip, metadata, logger, metrics, opts);

    this.peerManager = new PeerManager(
      {
        libp2p,
        reqResp: this.reqResp,
        gossip: this.gossip,
        attnetsService: this.attnetsService,
        syncnetsService: this.syncnetsService,
        logger,
        metrics,
        chain,
        config,
        peerRpcScores,
        networkEventBus,
        peersData: this.peersData,
      },
      opts
    );

    this.chain.emitter.on(ChainEvent.clockEpoch, this.onEpoch);
    this.chain.emitter.on(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.on(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    modules.signal.addEventListener("abort", this.close.bind(this), {once: true});
  }

  /** Destroy this instance. Can only be called once. */
  close(): void {
    this.chain.emitter.off(ChainEvent.clockEpoch, this.onEpoch);
    this.chain.emitter.off(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
  }

  async start(): Promise<void> {
    await this.libp2p.start();

    // Network spec decides version changes based on clock fork, not head fork
    const forkCurrentSlot = this.config.getForkName(this.clock.currentSlot);

    // Register only ReqResp protocols relevant to clock's fork
    await this.reqResp.start();
    this.reqResp.registerProtocolsAtFork(forkCurrentSlot);

    await this.peerManager.start();
    const discv5 = this.discv5();
    const setEnrValue = discv5?.setEnrValue.bind(discv5);
    // Initialize ENR with clock's fork
    this.metadata.start(setEnrValue, this.config.getForkName(this.clock.currentSlot));
    await this.gossip.start();
    this.attnetsService.start();
    this.syncnetsService.start();
    const multiaddresses = this.libp2p
      .getMultiaddrs()
      .map((m) => m.toString())
      .join(",");
    this.logger.info(`PeerId ${this.libp2p.peerId.toString()}, Multiaddrs ${multiaddresses}`);
  }

  async stop(): Promise<void> {
    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    await this.peerManager.stop();
    await this.gossip.stop();

    await this.reqResp.stop();
    await this.reqResp.unregisterAllProtocols();

    this.attnetsService.stop();
    this.syncnetsService.stop();
    await this.libp2p.stop();
  }

  discv5(): Discv5Worker | undefined {
    return this.peerManager["discovery"]?.discv5;
  }

  get localMultiaddrs(): Multiaddr[] {
    return this.libp2p.getMultiaddrs();
  }

  get peerId(): PeerId {
    return this.libp2p.peerId;
  }

  async getEnr(): Promise<SignableENR | undefined> {
    return await this.peerManager["discovery"]?.discv5.enr();
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    return getConnectionsMap(this.libp2p.connectionManager);
  }

  getConnectedPeers(): PeerId[] {
    return this.peerManager.getConnectedPeerIds();
  }

  hasSomeConnectedPeer(): boolean {
    return this.peerManager.hasSomeConnectedPeer();
  }

  publishBeaconBlockMaybeBlobs(blockInput: BlockInput): Promise<void> {
    switch (blockInput.type) {
      case BlockInputType.preDeneb:
        return this.gossip.publishBeaconBlock(blockInput.block);

      case BlockInputType.postDeneb:
        return this.gossip.publishSignedBeaconBlockAndBlobsSidecar({
          beaconBlock: blockInput.block as deneb.SignedBeaconBlock,
          blobsSidecar: blockInput.blobs,
        });

      case BlockInputType.postDenebOldBlobs:
        throw Error(`Attempting to broadcast old BlockInput slot ${blockInput.block.message.slot}`);
    }
  }

  async beaconBlocksMaybeBlobsByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<BlockInput[]> {
    return doBeaconBlocksMaybeBlobsByRange(this.config, this.reqResp, peerId, request, this.clock.currentEpoch);
  }

  async beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]> {
    // Assume all requests are post Deneb
    if (this.config.getForkSeq(this.chain.forkChoice.getFinalizedBlock().slot) >= ForkSeq.deneb) {
      const blocksAndBlobs = await this.reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request);
      return blocksAndBlobs.map(({beaconBlock, blobsSidecar}) =>
        getBlockInput.postDeneb(this.config, beaconBlock, blobsSidecar)
      );
    }

    // Assume all request are pre Deneb
    else if (this.config.getForkSeq(this.clock.currentSlot) < ForkSeq.deneb) {
      const blocks = await this.reqResp.beaconBlocksByRoot(peerId, request);
      return blocks.map((block) => getBlockInput.preDeneb(this.config, block));
    }

    // NOTE: Consider blocks may be post or pre Deneb
    // TODO Deneb: Request either blocks, or blocks+blobs
    else {
      const results = await Promise.all(
        request.map(
          async (beaconBlockRoot): Promise<BlockInput | null> => {
            const [resultBlockBlobs, resultBlocks] = await Promise.allSettled([
              this.reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, [beaconBlockRoot]),
              this.reqResp.beaconBlocksByRoot(peerId, [beaconBlockRoot]),
            ]);

            if (resultBlockBlobs.status === "fulfilled" && resultBlockBlobs.value.length === 1) {
              const {beaconBlock, blobsSidecar} = resultBlockBlobs.value[0];
              return getBlockInput.postDeneb(this.config, beaconBlock, blobsSidecar);
            }

            if (resultBlocks.status === "rejected") {
              return Promise.reject(resultBlocks.reason);
            }

            // Promise fullfilled + no result = block not found
            if (resultBlocks.value.length < 1) {
              return null;
            }

            const block = resultBlocks.value[0];

            if (this.config.getForkSeq(block.message.slot) >= ForkSeq.deneb) {
              // beaconBlockAndBlobsSidecarByRoot should have succeeded
              if (resultBlockBlobs.status === "rejected") {
                // Recycle existing error for beaconBlockAndBlobsSidecarByRoot if any
                return Promise.reject(resultBlockBlobs.reason);
              } else {
                throw Error(
                  `Received post Deneb ${beaconBlockRoot} over beaconBlocksByRoot not beaconBlockAndBlobsSidecarByRoot`
                );
              }
            }

            // Block is pre Deneb
            return getBlockInput.preDeneb(this.config, block);
          }
        )
      );

      return results.filter((blockOrNull): blockOrNull is BlockInput => blockOrNull !== null);
    }
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  prepareBeaconCommitteeSubnet(subscriptions: CommitteeSubscription[]): void {
    this.attnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): void {
    this.syncnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  reStatusPeers(peers: PeerId[]): void {
    this.peerManager.reStatusPeers(peers);
  }

  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void {
    this.peerRpcScores.applyAction(peer, action, actionName);
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  subscribeGossipCoreTopics(): void {
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
  unsubscribeGossipCoreTopics(): void {
    for (const fork of this.subscribedForks.values()) {
      this.unsubscribeCoreTopicsAtFork(fork);
    }

    // Drop all the gossip validation queues
    for (const jobQueue of Object.values(this.gossip.jobQueues)) {
      jobQueue.dropAllJobs();
    }
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

  getAgentVersion(peerIdStr: string): string {
    return this.peersData.getAgentVersion(peerIdStr);
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

  private subscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.gossip.subscribeTopic({...topic, fork});
    }
  };

  private unsubscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.gossip.unsubscribeTopic({...topic, fork});
    }
  };

  /**
   * De-duplicate logic to pick fork topics between subscribeCoreTopicsAtFork and unsubscribeCoreTopicsAtFork
   */
  private coreTopicsAtFork(fork: ForkName): GossipTopicTypeMap[keyof GossipTopicTypeMap][] {
    // Common topics for all forks
    const topics: GossipTopicTypeMap[keyof GossipTopicTypeMap][] = [
      // {type: GossipType.beacon_block}, // Handled below
      {type: GossipType.beacon_aggregate_and_proof},
      {type: GossipType.voluntary_exit},
      {type: GossipType.proposer_slashing},
      {type: GossipType.attester_slashing},
    ];

    // After Deneb only track beacon_block_and_blobs_sidecar topic
    if (ForkSeq[fork] < ForkSeq.deneb) {
      topics.push({type: GossipType.beacon_block});
    } else {
      topics.push({type: GossipType.beacon_block_and_blobs_sidecar});
    }

    // capella
    if (ForkSeq[fork] >= ForkSeq.capella) {
      topics.push({type: GossipType.bls_to_execution_change});
    }

    // Any fork after altair included
    if (ForkSeq[fork] >= ForkSeq.altair) {
      topics.push({type: GossipType.sync_committee_contribution_and_proof});
      topics.push({type: GossipType.light_client_optimistic_update});
      topics.push({type: GossipType.light_client_finality_update});
    }

    if (this.opts.subscribeAllSubnets) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        topics.push({type: GossipType.beacon_attestation, subnet});
      }
      if (ForkSeq[fork] >= ForkSeq.altair) {
        for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
          topics.push({type: GossipType.sync_committee, subnet});
        }
      }
    }

    return topics;
  }

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
        return await this.gossip.publishLightClientFinalityUpdate(finalityUpdate);
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
        return await this.gossip.publishLightClientOptimisticUpdate(optimisticUpdate);
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
