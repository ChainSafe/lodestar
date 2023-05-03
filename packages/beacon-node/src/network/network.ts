import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {BeaconConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {computeStartSlotAtEpoch, computeTimeAtSlot} from "@lodestar/state-transition";
import {phase0, allForks, deneb, altair, Root, capella} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {ResponseIncoming} from "@lodestar/reqresp";
import {ForkName, ForkSeq} from "@lodestar/params";
import {Metrics, RegistryMetricCreator} from "../metrics/index.js";
import {IBeaconChain} from "../chain/index.js";
import {IBeaconDb} from "../db/interface.js";
import {PeerSet} from "../util/peerMap.js";
import {IClock} from "../util/clock.js";
import {BlockInput, BlockInputType} from "../chain/blocks/types.js";
import {NetworkOptions} from "./options.js";
import {INetwork} from "./interface.js";
import {ReqRespMethod} from "./reqresp/index.js";
import {GossipHandlers, GossipTopicMap, GossipType, GossipTypeMap} from "./gossip/index.js";
import {PeerAction, PeerScoreStats} from "./peers/index.js";
import {INetworkEventBus, NetworkEvent, NetworkEventBus, NetworkEventData} from "./events.js";
import {CommitteeSubscription} from "./subnets/index.js";
import {isPublishToZeroPeersError} from "./util.js";
import {NetworkProcessor, PendingGossipsubMessage} from "./processor/index.js";
import {INetworkCore, NetworkCore, WorkerNetworkCore} from "./core/index.js";
import {collectExactOneTyped, collectMaxResponseTyped} from "./reqresp/utils/collect.js";
import {GetReqRespHandlerFn, Version, requestSszTypeByMethod, responseSszTypeByMethod} from "./reqresp/types.js";
import {collectSequentialBlocksInRange} from "./reqresp/utils/collectSequentialBlocksInRange.js";
import {getGossipSSZType, gossipTopicIgnoreDuplicatePublishError, stringifyGossipTopic} from "./gossip/topic.js";
import {AggregatorTracker} from "./processor/aggregatorTracker.js";

type NetworkModules = {
  opts: NetworkOptions;
  peerId: PeerId;
  config: BeaconConfig;
  logger: Logger;
  chain: IBeaconChain;
  signal: AbortSignal;
  networkEventBus: NetworkEventBus;
  aggregatorTracker: AggregatorTracker;
  networkProcessor: NetworkProcessor;
  core: INetworkCore;
};

export type NetworkInitModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  peerId: PeerId;
  peerStoreDir?: string;
  logger: Logger;
  metrics: Metrics | null;
  chain: IBeaconChain;
  db: IBeaconDb;
  getReqRespHandler: GetReqRespHandlerFn;
  signal: AbortSignal;
  // Optionally pass custom GossipHandlers, for testing
  gossipHandlers?: GossipHandlers;
};

/**
 * Must support running both on worker and on main thread.
 *
 * Exists a front class that's what consumers interact with.
 * This class will multiplex between:
 * - libp2p in worker
 * - libp2p in main thread
 */
export class Network implements INetwork {
  readonly peerId: PeerId;
  // TODO: Make private
  readonly events: INetworkEventBus;

  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly clock: IClock;
  private readonly chain: IBeaconChain;
  private readonly signal: AbortSignal;

  // TODO: Review
  private readonly networkProcessor: NetworkProcessor;
  private readonly core: INetworkCore;
  private readonly aggregatorTracker: AggregatorTracker;

  private subscribedToCoreTopics = false;
  private connectedPeers = new PeerSet();
  private regossipBlsChangesPromise: Promise<void> | null = null;
  private closed = false;

  constructor(modules: NetworkModules) {
    this.peerId = modules.peerId;
    this.config = modules.config;
    this.logger = modules.logger;
    this.chain = modules.chain;
    this.clock = modules.chain.clock;
    this.signal = modules.signal;
    this.events = modules.networkEventBus;
    this.networkProcessor = modules.networkProcessor;
    this.core = modules.core;
    this.aggregatorTracker = modules.aggregatorTracker;

    this.events.on(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
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
    chain,
    db,
    signal,
    gossipHandlers,
    peerId,
    peerStoreDir,
    getReqRespHandler,
  }: NetworkInitModules): Promise<Network> {
    const events = new NetworkEventBus();
    const aggregatorTracker = new AggregatorTracker();

    const activeValidatorCount = chain.getHeadState().epochCtx.currentShuffling.activeIndices.length;
    const initialStatus = chain.getStatus();

    const core = opts.useWorker
      ? await WorkerNetworkCore.init({
          opts: {
            ...opts,
            peerStoreDir,
            metrics: Boolean(metrics),
            activeValidatorCount,
            genesisTime: chain.genesisTime,
            initialStatus,
          },
          config,
          peerId,
          logger,
          events,
          getReqRespHandler,
        })
      : await NetworkCore.init({
          opts,
          config,
          peerId,
          peerStoreDir,
          logger,
          clock: chain.clock,
          events,
          getReqRespHandler,
          metricsRegistry: metrics ? new RegistryMetricCreator() : null,
          initialStatus,
          activeValidatorCount,
        });

    const networkProcessor = new NetworkProcessor(
      {chain, db, config, logger, metrics, events, gossipHandlers, core, aggregatorTracker},
      opts
    );

    const multiaddresses = opts.localMultiaddrs?.join(",");
    logger.info(`PeerId ${peerId.toString()}, Multiaddrs ${multiaddresses}`);

    return new Network({
      opts,
      peerId,
      config,
      logger,
      chain,
      signal,
      networkEventBus: events,
      aggregatorTracker,
      networkProcessor,
      core,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.events.off(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    this.chain.emitter.off(routes.events.EventType.head, this.onHead);
    this.chain.emitter.off(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    return this.core.scrapeMetrics();
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    for (const subscription of subscriptions) {
      if (subscription.isAggregator) {
        this.aggregatorTracker.addAggregator(subscription.subnet, subscription.slot);
      }
    }
    return this.core.prepareBeaconCommitteeSubnets(subscriptions);
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.core.prepareSyncCommitteeSubnets(subscriptions);
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

  // REST API queries
  getConnectedPeers(): PeerId[] {
    return Array.from(this.connectedPeers.values());
  }
  getConnectedPeerCount(): number {
    return this.connectedPeers.size;
  }

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.core.getNetworkIdentity();
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
    // Drop all the gossip validation queues
    this.networkProcessor.dropAllJobs();

    return this.core.unsubscribeGossipCoreTopics();
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.subscribedToCoreTopics;
  }

  shouldAggregate(subnet: number, slot: number): boolean {
    return this.aggregatorTracker.shouldAggregate(subnet, slot);
  }

  // Gossip

  async publishBeaconBlockMaybeBlobs(blockInput: BlockInput): Promise<number> {
    switch (blockInput.type) {
      case BlockInputType.preDeneb:
        return this.publishBeaconBlock(blockInput.block);

      case BlockInputType.postDeneb:
        return this.publishSignedBeaconBlockAndBlobsSidecar({
          beaconBlock: blockInput.block as deneb.SignedBeaconBlock,
          blobsSidecar: blockInput.blobs,
        });
    }
  }

  async publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): Promise<number> {
    const fork = this.config.getForkName(signedBlock.message.slot);
    return this.publishGossip<GossipType.beacon_block>({type: GossipType.beacon_block, fork}, signedBlock, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): Promise<number> {
    const fork = this.config.getForkName(item.beaconBlock.message.slot);
    return this.publishGossip<GossipType.beacon_block_and_blobs_sidecar>(
      {type: GossipType.beacon_block_and_blobs_sidecar, fork},
      item,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<number> {
    const fork = this.config.getForkName(aggregateAndProof.message.aggregate.data.slot);
    return this.publishGossip<GossipType.beacon_aggregate_and_proof>(
      {type: GossipType.beacon_aggregate_and_proof, fork},
      aggregateAndProof,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<number> {
    const fork = this.config.getForkName(attestation.data.slot);
    return this.publishGossip<GossipType.beacon_attestation>(
      {type: GossipType.beacon_attestation, fork, subnet},
      attestation,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<number> {
    const fork = this.config.getForkName(computeStartSlotAtEpoch(voluntaryExit.message.epoch));
    return this.publishGossip<GossipType.voluntary_exit>({type: GossipType.voluntary_exit, fork}, voluntaryExit, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<number> {
    return this.publishGossip<GossipType.bls_to_execution_change>(
      {type: GossipType.bls_to_execution_change, fork: ForkName.capella},
      blsToExecutionChange,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<number> {
    const fork = this.config.getForkName(Number(proposerSlashing.signedHeader1.message.slot as bigint));
    return this.publishGossip<GossipType.proposer_slashing>(
      {type: GossipType.proposer_slashing, fork},
      proposerSlashing
    );
  }

  async publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<number> {
    const fork = this.config.getForkName(Number(attesterSlashing.attestation1.data.slot as bigint));
    return this.publishGossip<GossipType.attester_slashing>(
      {type: GossipType.attester_slashing, fork},
      attesterSlashing
    );
  }

  async publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): Promise<number> {
    const fork = this.config.getForkName(signature.slot);
    return this.publishGossip<GossipType.sync_committee>({type: GossipType.sync_committee, fork, subnet}, signature, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<number> {
    const fork = this.config.getForkName(contributionAndProof.message.contribution.slot);
    return this.publishGossip<GossipType.sync_committee_contribution_and_proof>(
      {type: GossipType.sync_committee_contribution_and_proof, fork},
      contributionAndProof,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishLightClientFinalityUpdate(update: allForks.LightClientFinalityUpdate): Promise<number> {
    const fork = this.config.getForkName(update.signatureSlot);
    return this.publishGossip<GossipType.light_client_finality_update>(
      {type: GossipType.light_client_finality_update, fork},
      update
    );
  }

  async publishLightClientOptimisticUpdate(update: allForks.LightClientOptimisticUpdate): Promise<number> {
    const fork = this.config.getForkName(update.signatureSlot);
    return this.publishGossip<GossipType.light_client_optimistic_update>(
      {type: GossipType.light_client_optimistic_update, fork},
      update
    );
  }

  private async publishGossip<K extends GossipType>(
    topic: GossipTopicMap[K],
    object: GossipTypeMap[K],
    opts?: PublishOpts | undefined
  ): Promise<number> {
    const topicStr = stringifyGossipTopic(this.config, topic);
    const sszType = getGossipSSZType(topic);
    const messageData = (sszType.serialize as (object: GossipTypeMap[GossipType]) => Uint8Array)(object);
    opts = {
      ...opts,
      ignoreDuplicatePublishError: gossipTopicIgnoreDuplicatePublishError[topic.type],
    };
    const result = await this.core.publishGossip(topicStr, messageData, opts);

    const sentPeers = result.recipients.length;
    this.logger.verbose("Publish to topic", {topic: topicStr, sentPeers});
    return sentPeers;
  }

  // ReqResp

  async sendBeaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectSequentialBlocksInRange(
      this.sendReqRespRequest(
        peerId,
        ReqRespMethod.BeaconBlocksByRange,
        // Before altair, prioritize V2. After altair only request V2
        this.config.getForkSeq(this.clock.currentSlot) >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        request
      ),
      request
    );
  }

  async sendBeaconBlocksByRoot(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectMaxResponseTyped(
      this.sendReqRespRequest(
        peerId,
        ReqRespMethod.BeaconBlocksByRoot,
        // Before altair, prioritize V2. After altair only request V2
        this.config.getForkSeq(this.clock.currentSlot) >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        request
      ),
      request.length,
      responseSszTypeByMethod[ReqRespMethod.BeaconBlocksByRoot]
    );
  }

  async sendLightClientBootstrap(peerId: PeerId, request: Root): Promise<allForks.LightClientBootstrap> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientBootstrap, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap]
    );
  }

  async sendLightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientOptimisticUpdate, [Version.V1], null),
      responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate]
    );
  }

  async sendLightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientFinalityUpdate, [Version.V1], null),
      responseSszTypeByMethod[ReqRespMethod.LightClientFinalityUpdate]
    );
  }

  async sendLightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return collectMaxResponseTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientUpdatesByRange, [Version.V1], request),
      request.count,
      responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange]
    );
  }

  async sendBlobsSidecarsByRange(
    peerId: PeerId,
    request: deneb.BlobsSidecarsByRangeRequest
  ): Promise<deneb.BlobsSidecar[]> {
    return collectMaxResponseTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.BlobsSidecarsByRange, [Version.V1], request),
      request.count,
      responseSszTypeByMethod[ReqRespMethod.BlobsSidecarsByRange]
    );
  }

  async sendBeaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return collectMaxResponseTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot, [Version.V1], request),
      request.length,
      responseSszTypeByMethod[ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]
    );
  }

  private sendReqRespRequest<Req>(
    peerId: PeerId,
    method: ReqRespMethod,
    versions: number[],
    request: Req
  ): AsyncIterable<ResponseIncoming> {
    const requestType = requestSszTypeByMethod[method];
    const requestData = requestType ? requestType.serialize(request as never) : new Uint8Array();

    // ReqResp outgoing request, emit from main thread to worker
    return this.core.sendReqRespRequest({
      peerId,
      method,
      versions,
      requestData,
    });
  }

  // Debug

  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.core.connectToPeer(peer, multiaddr);
  }

  disconnectPeer(peer: PeerId): Promise<void> {
    return this.core.disconnectPeer(peer);
  }

  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.core.dumpPeer(peerIdStr);
  }

  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.core.dumpPeers();
  }

  dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.core.dumpPeerScoreStats();
  }

  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.core.dumpGossipPeerScoreStats();
  }

  dumpDiscv5KadValues(): Promise<string[]> {
    return this.core.dumpDiscv5KadValues();
  }

  dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.core.dumpMeshPeers();
  }

  async dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]> {
    return this.networkProcessor.dumpGossipQueue(gossipType);
  }

  private onLightClientFinalityUpdate = async (finalityUpdate: allForks.LightClientFinalityUpdate): Promise<void> => {
    // TODO: Review is OK to remove if (this.hasAttachedSyncCommitteeMember())

    try {
      // messages SHOULD be broadcast after one-third of slot has transpired
      // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
      await this.waitOneThirdOfSlot(finalityUpdate.signatureSlot);
      await this.publishLightClientFinalityUpdate(finalityUpdate);
    } catch (e) {
      // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
      // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
      if (!isPublishToZeroPeersError(e as Error)) {
        this.logger.debug("Error on BeaconGossipHandler.onLightclientFinalityUpdate", {}, e as Error);
      }
    }
  };

  private onLightClientOptimisticUpdate = async (
    optimisticUpdate: allForks.LightClientOptimisticUpdate
  ): Promise<void> => {
    // TODO: Review is OK to remove if (this.hasAttachedSyncCommitteeMember())

    try {
      // messages SHOULD be broadcast after one-third of slot has transpired
      // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
      await this.waitOneThirdOfSlot(optimisticUpdate.signatureSlot);
      await this.publishLightClientOptimisticUpdate(optimisticUpdate);
    } catch (e) {
      // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
      // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
      if (!isPublishToZeroPeersError(e as Error)) {
        this.logger.debug("Error on BeaconGossipHandler.onLightclientOptimisticUpdate", {}, e as Error);
      }
    }
  };

  private waitOneThirdOfSlot = async (slot: number): Promise<void> => {
    const secAtSlot = computeTimeAtSlot(this.config, slot + 1 / 3, this.chain.genesisTime);
    const msToSlot = secAtSlot * 1000 - Date.now();
    await sleep(msToSlot, this.signal);
  };

  private onHead = async (): Promise<void> => {
    await this.core.updateStatus(this.chain.getStatus());
  };

  private onPeerConnected = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    this.connectedPeers.add(data.peer);
  };

  private onPeerDisconnected = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    this.connectedPeers.delete(data.peer);
  };
}
