/**
 * @module network
 */

import LibP2p, {Connection} from "libp2p";
import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {Discv5, ENR} from "@chainsafe/discv5";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Epoch} from "@chainsafe/lodestar-types";
import {IMetrics} from "../metrics";
import {ChainEvent, IBeaconChain, IBeaconClock} from "../chain";
import {INetworkOptions} from "./options";
import {INetwork} from "./interface";
import {ReqResp, IReqResp, IReqRespOptions, ReqRespHandlers} from "./reqresp";
import {Eth2Gossipsub, GossipType, GossipHandlers, getGossipHandlers} from "./gossip";
import {MetadataController} from "./metadata";
import {getActiveForks, FORK_EPOCH_LOOKAHEAD} from "./forks";
import {PeerManager} from "./peers/peerManager";
import {IPeerRpcScoreStore, PeerAction, PeerRpcScoreStore} from "./peers";
import {INetworkEventBus, NetworkEventBus} from "./events";
import {AttnetsService, SyncnetsService, CommitteeSubscription} from "./subnets";
import {PeersData} from "./peers/peersData";

interface INetworkModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
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
  reqResp: IReqResp;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly peersData: PeersData;

  private readonly peerManager: PeerManager;
  private readonly libp2p: LibP2p;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;
  private readonly clock: IBeaconClock;
  private readonly chain: IBeaconChain;

  private subscribedForks = new Set<ForkName>();

  constructor(private readonly opts: INetworkOptions & IReqRespOptions, modules: INetworkModules) {
    const {config, libp2p, logger, metrics, chain, reqRespHandlers, gossipHandlers, signal} = modules;
    this.libp2p = libp2p;
    this.logger = logger;
    this.config = config;
    this.clock = chain.clock;
    this.chain = chain;
    this.peersData = new PeersData();
    const networkEventBus = new NetworkEventBus();
    const metadata = new MetadataController({}, {config, chain, logger});
    const peerRpcScores = new PeerRpcScoreStore(metrics);
    this.events = networkEventBus;
    this.metadata = metadata;
    this.peerRpcScores = peerRpcScores;
    this.reqResp = new ReqResp(
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
    modules.signal.addEventListener("abort", this.close.bind(this), {once: true});
  }

  /** Destroy this instance. Can only be called once. */
  close(): void {
    this.chain.emitter.off(ChainEvent.clockEpoch, this.onEpoch);
  }

  async start(): Promise<void> {
    await this.libp2p.start();
    // Stop latency monitor since we handle disconnects here and don't want additional load on the event loop
    this.libp2p.connectionManager._latencyMonitor.stop();

    this.reqResp.start();
    this.metadata.start(this.getEnr(), this.config.getForkName(this.clock.currentSlot));
    await this.peerManager.start();
    await this.gossip.start();
    this.attnetsService.start();
    this.syncnetsService.start();
    const multiaddresses = this.libp2p.multiaddrs.map((m) => m.toString()).join(",");
    this.logger.info(`PeerId ${this.libp2p.peerId.toB58String()}, Multiaddrs ${multiaddresses}`);
  }

  async stop(): Promise<void> {
    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    await this.peerManager.stop();
    await this.gossip.stop();
    this.reqResp.stop();
    this.attnetsService.stop();
    this.syncnetsService.stop();
    await this.libp2p.stop();
  }

  get discv5(): Discv5 | undefined {
    return this.peerManager["discovery"]?.discv5;
  }

  get localMultiaddrs(): Multiaddr[] {
    return this.libp2p.multiaddrs;
  }

  get peerId(): PeerId {
    return this.libp2p.peerId;
  }

  getEnr(): ENR | undefined {
    return this.peerManager["discovery"]?.discv5.enr;
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    return this.libp2p.connectionManager.connections;
  }

  getConnectedPeers(): PeerId[] {
    return this.peerManager.getConnectedPeerIds();
  }

  getSyncedPeers(): PeerId[] {
    return this.peerManager.getSyncedPeers();
  }

  hasSomeConnectedPeer(): boolean {
    return this.peerManager.hasSomeConnectedPeer();
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

  reportPeer(peer: PeerId, action: PeerAction, actionName?: string): void {
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
            this.logger.info("Subscribing gossip topics to next fork", {nextFork});
            // Don't subscribe to new fork if the node is not subscribed to any topic
            if (this.isSubscribedToGossipCoreTopics()) this.subscribeCoreTopicsAtFork(nextFork);
            this.attnetsService.subscribeSubnetsToNextFork(nextFork);
            this.syncnetsService.subscribeSubnetsToNextFork(nextFork);
          }

          // On fork transition
          if (epoch === forkEpoch) {
            // updateEth2Field() MUST be called with clock epoch, onEpoch event is emitted in response to clock events
            this.metadata.updateEth2Field(epoch);
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

    this.gossip.subscribeTopic({type: GossipType.beacon_block, fork});
    this.gossip.subscribeTopic({type: GossipType.beacon_aggregate_and_proof, fork});
    this.gossip.subscribeTopic({type: GossipType.voluntary_exit, fork});
    this.gossip.subscribeTopic({type: GossipType.proposer_slashing, fork});
    this.gossip.subscribeTopic({type: GossipType.attester_slashing, fork});
    // Any fork after altair included
    if (fork !== ForkName.phase0) {
      this.gossip.subscribeTopic({type: GossipType.sync_committee_contribution_and_proof, fork});
    }

    if (this.opts.subscribeAllSubnets) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        this.gossip.subscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
      }
      for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
        this.gossip.subscribeTopic({type: GossipType.sync_committee, fork, subnet});
      }
    }
  };

  private unsubscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);

    this.gossip.unsubscribeTopic({type: GossipType.beacon_block, fork});
    this.gossip.unsubscribeTopic({type: GossipType.beacon_aggregate_and_proof, fork});
    this.gossip.unsubscribeTopic({type: GossipType.voluntary_exit, fork});
    this.gossip.unsubscribeTopic({type: GossipType.proposer_slashing, fork});
    this.gossip.unsubscribeTopic({type: GossipType.attester_slashing, fork});
    // Any fork after altair included
    if (fork !== ForkName.phase0) {
      this.gossip.unsubscribeTopic({type: GossipType.sync_committee_contribution_and_proof, fork});
    }

    if (this.opts.subscribeAllSubnets) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        this.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
      }
      for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
        this.gossip.unsubscribeTopic({type: GossipType.sync_committee, fork, subnet});
      }
    }
  };
}
