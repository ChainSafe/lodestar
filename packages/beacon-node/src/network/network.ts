import {Libp2p} from "libp2p";
import {DefaultConnectionManager} from "libp2p/connection-manager";
import {Connection} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {IBeaconConfig} from "@lodestar/config";
import {ILogger, sleep} from "@lodestar/utils";
import {ATTESTATION_SUBNET_COUNT, ForkName, ForkSeq, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {Discv5, ENR} from "@chainsafe/discv5";
import {computeEpochAtSlot, computeTimeAtSlot} from "@lodestar/state-transition";
import {altair, Epoch, phase0} from "@lodestar/types";
import {IMetrics} from "../metrics/index.js";
import {ChainEvent, IBeaconChain, IBeaconClock} from "../chain/index.js";
import {BlockInput, BlockInputType, getBlockInput} from "../chain/blocks/types.js";
import {INetworkOptions} from "./options.js";
import {INetwork} from "./interface.js";
import {ReqRespBeaconNode, ReqRespHandlers} from "./reqresp/ReqRespBeaconNode.js";
import {Eth2Gossipsub, getGossipHandlers, GossipHandlers, GossipTopicTypeMap, GossipType} from "./gossip/index.js";
import {MetadataController} from "./metadata.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForks} from "./forks.js";
import {PeerManager} from "./peers/peerManager.js";
import {IPeerRpcScoreStore, PeerAction, PeerRpcScoreStore} from "./peers/index.js";
import {INetworkEventBus, NetworkEventBus} from "./events.js";
import {AttnetsService, CommitteeSubscription, SyncnetsService} from "./subnets/index.js";
import {PeersData} from "./peers/peersData.js";
import {getConnectionsMap, isPublishToZeroPeersError} from "./util.js";

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
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly peersData: PeersData;

  private readonly peerManager: PeerManager;
  private readonly libp2p: Libp2p;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;
  private readonly clock: IBeaconClock;
  private readonly chain: IBeaconChain;
  private readonly signal: AbortSignal;

  private subscribedForks = new Set<ForkName>();

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    void this.gossip.init((libp2p as any).components).catch((e) => this.logger.error(e));

    this.attnetsService = new AttnetsService(config, chain, this.gossip, metadata, logger, opts);
    this.syncnetsService = new SyncnetsService(config, chain, this.gossip, metadata, logger, opts);

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
    this.chain.emitter.on(ChainEvent.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.on(ChainEvent.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    modules.signal.addEventListener("abort", this.close.bind(this), {once: true});
  }

  /** Destroy this instance. Can only be called once. */
  close(): void {
    this.chain.emitter.off(ChainEvent.clockEpoch, this.onEpoch);
    this.chain.emitter.off(ChainEvent.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(ChainEvent.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
  }

  async start(): Promise<void> {
    await this.libp2p.start();
    // Stop latency monitor since we handle disconnects here and don't want additional load on the event loop
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    (this.libp2p.connectionManager as DefaultConnectionManager)["latencyMonitor"].stop();

    // Network spec decides version changes based on clock fork, not head fork
    const forkCurrentSlot = this.config.getForkName(this.clock.currentSlot);

    // Register only ReqResp protocols relevant to clock's fork
    await this.reqResp.start();
    this.reqResp.registerProtocolsAtFork(forkCurrentSlot);

    // Initialize ENR with clock's fork
    this.metadata.start(this.getEnr(), forkCurrentSlot);

    await this.peerManager.start();
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

  get discv5(): Discv5 | undefined {
    return this.peerManager["discovery"]?.discv5;
  }

  get localMultiaddrs(): Multiaddr[] {
    return this.libp2p.getMultiaddrs();
  }

  get peerId(): PeerId {
    return this.libp2p.peerId;
  }

  getEnr(): ENR | undefined {
    return this.peerManager["discovery"]?.discv5.enr;
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

  publishBeaconBlockMaybeBlobs(blockImport: BlockInput): Promise<void> {
    switch (blockImport.type) {
      case BlockInputType.preEIP4844:
        return this.gossip.publishBeaconBlock(blockImport.block);

      case BlockInputType.postEIP4844:
        // TODO EIP-4844: Implement SignedBeaconBlockAndBlobsSidecar publish topic
        throw Error("SignedBeaconBlockAndBlobsSidecar publish not implemented");

      case BlockInputType.postEIP4844OldBlobs:
        throw Error(`Attempting to broadcast old BlockImport slot ${blockImport.block.message.slot}`);
    }
  }

  async beaconBlocksMaybeBlobsByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<BlockInput[]> {
    // TODO EIP-4844: Assumes all blocks in the same epoch
    // TODO EIP-4844: Ensure all blocks are in the same epoch
    if (this.config.getForkSeq(request.startSlot) < ForkSeq.eip4844) {
      const blocks = await this.reqResp.beaconBlocksByRange(peerId, request);
      return blocks.map((block) => getBlockInput.preEIP4844(this.config, block));
    }

    // Only request blobs if they are recent enough
    else if (
      computeEpochAtSlot(request.startSlot) >=
      this.chain.clock.currentEpoch - this.config.MIN_EPOCHS_FOR_BLOBS_SIDECARS_REQUESTS
    ) {
      // TODO EIP-4844: Do two requests at once for blocks and blobs
      const blocks = await this.reqResp.beaconBlocksByRange(peerId, request);
      const blobsSidecars = await this.reqResp.blobsSidecarsByRange(peerId, request);

      if (blocks.length !== blobsSidecars.length) {
        throw Error(`blocks.length ${blocks.length} != blobsSidecars.length ${blobsSidecars.length}`);
      }

      const blockImports: BlockInput[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blobsSidecar = blobsSidecars[i];

        // TODO EIP-4844: Do more verification blob is for block
        if (block.message.slot !== blobsSidecar.beaconBlockSlot) {
          throw Error(`blob does not match block slot ${block.message.slot} != ${blobsSidecar.beaconBlockSlot}`);
        }

        blockImports.push(getBlockInput.postEIP4844(this.config, block, blobsSidecar));
      }
      return blockImports;
    }

    // Post EIP-4844 but old blobs
    else {
      const blocks = await this.reqResp.beaconBlocksByRange(peerId, request);
      return blocks.map((block) => getBlockInput.postEIP4844OldBlobs(this.config, block));
    }
  }

  async beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]> {
    // Assume all requests are post EIP-4844
    if (this.config.getForkSeq(this.chain.forkChoice.getFinalizedBlock().slot) >= ForkSeq.eip4844) {
      const blocksAndBlobs = await this.reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request);
      return blocksAndBlobs.map(({beaconBlock, blobsSidecar}) =>
        getBlockInput.postEIP4844(this.config, beaconBlock, blobsSidecar)
      );
    }

    // Assume all request are pre EIP-4844
    else if (this.config.getForkSeq(this.clock.currentSlot) < ForkSeq.eip4844) {
      const blocks = await this.reqResp.beaconBlocksByRoot(peerId, request);
      return blocks.map((block) => getBlockInput.preEIP4844(this.config, block));
    }

    // NOTE: Consider blocks may be post or pre EIP-4844
    // TODO EIP-4844: Request either blocks, or blocks+blobs
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
              return getBlockInput.postEIP4844(this.config, beaconBlock, blobsSidecar);
            }

            if (resultBlocks.status === "rejected") {
              return Promise.reject(resultBlocks.reason);
            }

            // Promise fullfilled + no result = block not found
            if (resultBlocks.value.length < 1) {
              return null;
            }

            const block = resultBlocks.value[0];

            if (this.config.getForkSeq(block.message.slot) >= ForkSeq.eip4844) {
              // beaconBlockAndBlobsSidecarByRoot should have succeeded
              if (resultBlockBlobs.status === "rejected") {
                // Recycle existing error for beaconBlockAndBlobsSidecarByRoot if any
                return Promise.reject(resultBlockBlobs.reason);
              } else {
                throw Error(
                  `Received post EIP-4844 ${beaconBlockRoot} over beaconBlocksByRoot not beaconBlockAndBlobsSidecarByRoot`
                );
              }
            }

            // Block is pre EIP-4844
            return getBlockInput.preEIP4844(this.config, block);
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
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e as Error);
    }
  };

  private subscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);

    for (const topic of this.coreTopicsAtFork(fork)) {
      this.gossip.subscribeTopic({...topic, fork});
    }
  };

  private unsubscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);

    for (const topic of this.coreTopicsAtFork(fork)) {
      this.gossip.unsubscribeTopic({...topic, fork});
    }
  };

  /**
   * De-duplicate logic to pick fork topics between subscribeCoreTopicsAtFork and unsubscribeCoreTopicsAtFork
   */
  private coreTopicsAtFork(fork: ForkName): GossipTopicTypeMap[keyof GossipTopicTypeMap][] {
    // Common topics for all forks
    const topics: GossipTopicTypeMap[keyof GossipTopicTypeMap][] = [
      {type: GossipType.beacon_block},
      {type: GossipType.beacon_aggregate_and_proof},
      {type: GossipType.voluntary_exit},
      {type: GossipType.proposer_slashing},
      {type: GossipType.attester_slashing},
    ];

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

  private onLightClientFinalityUpdate = async (finalityUpdate: altair.LightClientFinalityUpdate): Promise<void> => {
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
    optimisticUpdate: altair.LightClientOptimisticUpdate
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
