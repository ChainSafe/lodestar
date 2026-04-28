import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {RootHex, gloas} from "@lodestar/types";
import {Logger, fromHex, prettyPrintIndices, pruneSetToMax, sleep, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../chain/blocks/blockInput/types.js";
import {PayloadError, PayloadErrorCode} from "../chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "../chain/blocks/payloadEnvelopeInput/index.js";
import {BlockError, BlockErrorCode} from "../chain/errors/index.js";
import {ChainEvent, ChainEventData, IBeaconChain} from "../chain/index.js";
import {validateGloasBlockDataColumnSidecars} from "../chain/validation/dataColumnSidecar.js";
import {validateGossipExecutionPayloadEnvelope} from "../chain/validation/executionPayloadEnvelope.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent, NetworkEventData, prettyPrintPeerIdStr} from "../network/index.js";
import {PeerSyncMeta} from "../network/peers/peersData.js";
import {PeerIdStr} from "../util/peerId.js";
import {shuffle} from "../util/shuffle.js";
import {sortBy} from "../util/sortBy.js";
import {wrapError} from "../util/wrapError.js";
import {MAX_CONCURRENT_REQUESTS} from "./constants.js";
import {SyncOptions} from "./options.js";
import {
  BlockInputSyncCacheItem,
  PayloadSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  PendingBlockType,
  PendingPayloadEnvelope,
  PendingPayloadInput,
  PendingPayloadInputStatus,
  PendingPayloadRootHex,
  getBlockInputSyncCacheItemRootHex,
  getBlockInputSyncCacheItemSlot,
  getPayloadSyncCacheItemRootHex,
  getPayloadSyncCacheItemSlot,
  isPendingBlockInput,
  isPendingPayloadEnvelope,
  isPendingPayloadInput,
} from "./types.js";
import {DownloadByRootError, downloadByRoot} from "./utils/downloadByRoot.js";
import {getAllDescendantBlocks, getUnknownAndAncestorBlocks} from "./utils/pendingBlocksTree.js";

const MAX_ATTEMPTS_PER_BLOCK = 5;
const MAX_KNOWN_BAD_BLOCKS = 500;
const MAX_PENDING_BLOCKS = 100;

type AdvancePendingBlockResult =
  | "ready"
  | "queued_block"
  | "queued_parent_block"
  | "queued_parent_payload"
  | "blocked"
  | "removed";

enum FetchResult {
  SuccessResolved = "success_resolved",
  SuccessMissingParent = "success_missing_parent",
  SuccessLate = "success_late",
  FailureTriedAllPeers = "failure_tried_all_peers",
  FailureMaxAttempts = "failure_max_attempts",
}

/**
 * BlockInputSync is a class that handles ReqResp to find blocks and data related to a specific blockRoot.  The
 * blockRoot may have been found via object gossip, or the API.  Gossip objects that can trigger a search are block,
 * blobs, columns, attestations, etc.  In the case of blocks and data this is generally during the current slot but
 * can also be for items that are received late but are not fully verified and thus not in fork-choice (old blocks on
 * an unknown fork). It can also be triggered via an attestation (or sync committee message or any other item that
 * gets gossiped) that references a blockRoot that is not in fork-choice.  In rare (and realistically should not happen)
 * situations it can get triggered via the API when the validator attempts to publish a block, attestation, aggregate
 * and proof or a sync committee contribution that has unknown information included (parentRoot for instance).
 *
 * The goal of the class is to make sure that all information that is necessary for import into fork-choice is pulled
 * from peers so that the block and data can be processed, and thus the object that triggered the search can be
 * referenced and validated.
 *
 * The most common case for this search is a set of block/data that comes across gossip for the current slot, during
 * normal chain operation, but not everything was received before the gossip cutoff window happens so it is necessary
 * to pull remaining data via req/resp so that fork-choice can be updated prior to making an attestation for the
 * current slot.
 *
 * Event sources for old UnknownBlock
 *
 * - publishBlock
 * - gossipHandlers
 * - searchUnknownBlock
 *    = produceSyncCommitteeContribution
 *    = validateGossipFnRetryUnknownRoot
 *        * submitPoolAttestationsV2
 *        * publishAggregateAndProofsV2
 *    = onPendingGossipsubMessage
 *        * NetworkEvent.pendingGossipsubMessage
 *            - onGossipsubMessage
 */
export class BlockInputSync {
  /**
   * block RootHex -> PendingBlock. To avoid finding same root at the same time
   */
  private readonly pendingBlocks = new Map<RootHex, BlockInputSyncCacheItem>();
  // Payload sync is keyed by beacon block root as well, so block and payload queues can unblock each other.
  private readonly pendingPayloads = new Map<RootHex, PayloadSyncCacheItem>();
  private readonly knownBadBlocks = new Set<RootHex>();
  private readonly maxPendingBlocks;
  private subscribedToNetworkEvents = false;
  private peerBalancer: UnknownBlockPeerBalancer;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly network: INetwork,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
    private readonly metrics: Metrics | null,
    private readonly opts?: SyncOptions
  ) {
    this.maxPendingBlocks = opts?.maxPendingBlocks ?? MAX_PENDING_BLOCKS;
    this.peerBalancer = new UnknownBlockPeerBalancer();

    if (metrics) {
      metrics.blockInputSync.pendingBlocks.addCollect(() =>
        metrics.blockInputSync.pendingBlocks.set(this.pendingBlocks.size)
      );
      metrics.blockInputSync.pendingPayloads.addCollect(() =>
        metrics.blockInputSync.pendingPayloads.set(this.pendingPayloads.size)
      );
      metrics.blockInputSync.knownBadBlocks.addCollect(() =>
        metrics.blockInputSync.knownBadBlocks.set(this.knownBadBlocks.size)
      );
    }
  }

  subscribeToNetwork(): void {
    if (this.opts?.disableBlockInputSync) {
      this.logger.verbose("BlockInputSync disabled by disableBlockInputSync option.");
      return;
    }

    // cannot chain to the above if or the log will be incorrect
    if (!this.subscribedToNetworkEvents) {
      this.logger.verbose("BlockInputSync enabled.");
      this.chain.emitter.on(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
      this.chain.emitter.on(ChainEvent.unknownEnvelopeBlockRoot, this.onUnknownEnvelopeBlockRoot);
      this.chain.emitter.on(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
      this.chain.emitter.on(ChainEvent.incompletePayloadEnvelope, this.onIncompletePayloadEnvelope);
      this.chain.emitter.on(ChainEvent.blockUnknownParent, this.onUnknownParent);
      this.chain.emitter.on(ChainEvent.envelopeUnknownBlock, this.onEnvelopeUnknownBlock);
      this.chain.emitter.on(routes.events.EventType.block, this.onBlockImported);
      this.chain.emitter.on(routes.events.EventType.executionPayload, this.onPayloadImported);
      this.network.events.on(NetworkEvent.peerConnected, this.onPeerConnected);
      this.network.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    this.chain.emitter.off(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
    this.chain.emitter.off(ChainEvent.unknownEnvelopeBlockRoot, this.onUnknownEnvelopeBlockRoot);
    this.chain.emitter.off(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
    this.chain.emitter.off(ChainEvent.incompletePayloadEnvelope, this.onIncompletePayloadEnvelope);
    this.chain.emitter.off(ChainEvent.blockUnknownParent, this.onUnknownParent);
    this.chain.emitter.off(ChainEvent.envelopeUnknownBlock, this.onEnvelopeUnknownBlock);
    this.chain.emitter.off(routes.events.EventType.block, this.onBlockImported);
    this.chain.emitter.off(routes.events.EventType.executionPayload, this.onPayloadImported);
    this.network.events.off(NetworkEvent.peerConnected, this.onPeerConnected);
    this.network.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    this.subscribedToNetworkEvents = false;
  }

  close(): void {
    this.unsubscribeFromNetwork();
  }

  isSubscribedToNetwork(): boolean {
    return this.subscribedToNetworkEvents;
  }

  /**
   * Process an unknownBlock event and register the block in `pendingBlocks` Map.
   */
  private onUnknownBlockRoot = (data: ChainEventData[ChainEvent.unknownBlockRoot]): void => {
    try {
      this.addByRootHex(data.rootHex, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_BLOCK_ROOT});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling unknownBlockRoot event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockInput event and register the block in `pendingBlocks` Map.
   */
  private onIncompleteBlockInput = (data: ChainEventData[ChainEvent.incompleteBlockInput]): void => {
    try {
      this.addByBlockInput(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.INCOMPLETE_BLOCK_INPUT});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling incompleteBlockInput event", {}, e as Error);
    }
  };

  private onUnknownEnvelopeBlockRoot = (data: ChainEventData[ChainEvent.unknownEnvelopeBlockRoot]): void => {
    try {
      this.addByPayloadRootHex(data.rootHex, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_DATA});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling unknownEnvelopeBlockRoot event", {}, e as Error);
    }
  };

  private onIncompletePayloadEnvelope = (data: ChainEventData[ChainEvent.incompletePayloadEnvelope]): void => {
    try {
      this.addByPayloadInput(data.payloadInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_DATA});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling incompletePayloadEnvelope event", {}, e as Error);
    }
  };

  /**
   * Process an unknownBlockParent event and register the block in `pendingBlocks` Map.
   */
  private onUnknownParent = (data: ChainEventData[ChainEvent.blockUnknownParent]): void => {
    try {
      const missingDependency = this.getMissingBlockDependency(data.blockInput);
      if (missingDependency.kind === "invalidParentPayload") {
        this.addByBlockInput(data.blockInput, data.peer);

        const pendingBlock = this.pendingBlocks.get(data.blockInput.blockRootHex);
        if (pendingBlock && isPendingBlockInput(pendingBlock)) {
          this.logger.debug("Ignoring block with conflicting parent payload hash", {
            slot: pendingBlock.blockInput.slot,
            root: pendingBlock.blockInput.blockRootHex,
            parentRoot: missingDependency.parentRootHex,
            parentBlockHash: missingDependency.parentBlockHashHex,
          });
          this.removeAndDownScoreAllDescendants(pendingBlock);
        }
        return;
      }

      if (missingDependency.kind === "parentPayload") {
        this.addByPayloadRootHex(missingDependency.rootHex, data.peer);
      } else if (missingDependency.kind === "parentBlock") {
        this.addByRootHex(missingDependency.rootHex, data.peer);
      }
      this.addByBlockInput(data.blockInput, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_PARENT});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling unknownParent event", {}, e as Error);
    }
  };

  private onEnvelopeUnknownBlock = (data: ChainEventData[ChainEvent.envelopeUnknownBlock]): void => {
    try {
      const blockRootHex = toRootHex(data.envelope.message.beaconBlockRoot);
      this.addByRootHex(blockRootHex, data.peer);
      this.addByPayloadEnvelope(data.envelope, data.peer);
      this.triggerUnknownBlockSearch();
      this.metrics?.blockInputSync.requests.inc({type: PendingBlockType.UNKNOWN_DATA});
      this.metrics?.blockInputSync.source.inc({source: data.source});
    } catch (e) {
      this.logger.debug("Error handling envelopeUnknownBlock event", {}, e as Error);
    }
  };

  private onBlockImported = (): void => {
    if (this.pendingPayloads.size > 0) {
      this.triggerUnknownBlockSearch();
    }
  };

  private onPayloadImported = ({
    blockRoot,
  }: routes.events.EventData[routes.events.EventType.executionPayload]): void => {
    this.pendingPayloads.delete(blockRoot);
    this.triggerUnknownBlockSearch();
  };

  private addByRootHex = (rootHex: RootHex, peerIdStr?: PeerIdStr): boolean => {
    let pendingBlock = this.pendingBlocks.get(rootHex);
    let added = false;
    if (!pendingBlock) {
      pendingBlock = {
        status: PendingBlockInputStatus.pending,
        rootHex: rootHex,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(rootHex, pendingBlock);
      added = true;

      this.logger.verbose("Added new rootHex to BlockInputSync.pendingBlocks", {
        root: pendingBlock.rootHex,
        peerIdStr: peerIdStr ?? "unknown peer",
      });
    }

    if (peerIdStr) {
      pendingBlock.peerIdStrings.add(peerIdStr);
    }

    // TODO: check this prune methodology
    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingBlocks`);
    }
    return added;
  };

  private addByBlockInput = (blockInput: IBlockInput, peerIdStr?: string): void => {
    let pendingBlock = this.pendingBlocks.get(blockInput.blockRootHex);
    // if entry is missing or was added via rootHex and now we have more complete information overwrite
    // the existing information with the more complete cache entry
    if (!pendingBlock || !isPendingBlockInput(pendingBlock)) {
      pendingBlock = {
        // can be added via unknown parent and we may already have full block input. need to check and set correctly
        // so we pull the data if its missing or handle the block correctly in getIncompleteAndAncestorBlocks
        status: blockInput.hasBlockAndAllData() ? PendingBlockInputStatus.downloaded : PendingBlockInputStatus.pending,
        blockInput,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingBlocks.set(blockInput.blockRootHex, pendingBlock);

      this.logger.verbose("Added blockInput to BlockInputSync.pendingBlocks", pendingBlock.blockInput.getLogMeta());
    }

    if (peerIdStr) {
      pendingBlock.peerIdStrings.add(peerIdStr);
    }

    // TODO: check this prune methodology
    // Limit pending blocks to prevent DOS attacks that cause OOM
    const prunedItemCount = pruneSetToMax(this.pendingBlocks, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingBlocks`);
    }
  };

  private addByPayloadRootHex = (rootHex: RootHex, peerIdStr?: PeerIdStr): boolean => {
    let pendingPayload = this.pendingPayloads.get(rootHex);
    let added = false;
    if (!pendingPayload) {
      pendingPayload = {
        status: PendingPayloadInputStatus.pending,
        rootHex,
        peerIdStrings: new Set(),
        timeAddedSec: Date.now() / 1000,
      };
      this.pendingPayloads.set(rootHex, pendingPayload);
      added = true;

      this.logger.verbose("Added new payload rootHex to BlockInputSync.pendingPayloads", {
        root: rootHex,
        peerIdStr: peerIdStr ?? "unknown peer",
      });
    }

    if (peerIdStr) {
      pendingPayload.peerIdStrings.add(peerIdStr);
    }

    const prunedItemCount = pruneSetToMax(this.pendingPayloads, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingPayloads`);
    }
    return added;
  };

  private addByPayloadEnvelope = (envelope: gloas.SignedExecutionPayloadEnvelope, peerIdStr?: PeerIdStr): void => {
    const rootHex = toRootHex(envelope.message.beaconBlockRoot);
    const existingPendingPayload = this.pendingPayloads.get(rootHex);
    let pendingPayload = this.pendingPayloads.get(rootHex);
    if (!pendingPayload || !isPendingPayloadEnvelope(pendingPayload)) {
      pendingPayload = {
        status: PendingPayloadInputStatus.waitingForBlock,
        envelope,
        peerIdStrings: new Set(existingPendingPayload?.peerIdStrings ?? []),
        timeAddedSec: existingPendingPayload?.timeAddedSec ?? Date.now() / 1000,
      };
      this.pendingPayloads.set(rootHex, pendingPayload);

      this.logger.verbose("Added payload envelope to BlockInputSync.pendingPayloads", {
        slot: envelope.message.payload.slotNumber,
        root: rootHex,
      });
    } else {
      this.logger.debug("Overwriting pending payload envelope for root already waiting for block", {
        slot: envelope.message.payload.slotNumber,
        root: rootHex,
      });
      pendingPayload.envelope = envelope;
    }

    if (peerIdStr) {
      pendingPayload.peerIdStrings.add(peerIdStr);
    }

    const prunedItemCount = pruneSetToMax(this.pendingPayloads, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingPayloads`);
    }
  };

  private addByPayloadInput = (
    payloadInput: PayloadEnvelopeInput,
    peerIdStr?: PeerIdStr,
    envelope?: gloas.SignedExecutionPayloadEnvelope
  ): void => {
    const pendingPayload = this.toPendingPayloadInput(
      payloadInput,
      this.pendingPayloads.get(payloadInput.blockRootHex),
      envelope
    );

    if (peerIdStr) {
      pendingPayload.peerIdStrings.add(peerIdStr);
    }

    this.pendingPayloads.set(payloadInput.blockRootHex, pendingPayload);
    const prunedItemCount = pruneSetToMax(this.pendingPayloads, this.maxPendingBlocks);
    if (prunedItemCount > 0) {
      this.logger.verbose(`Pruned ${prunedItemCount} items from BlockInputSync.pendingPayloads`);
    }
  };

  private onPeerConnected = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    try {
      const peerId = data.peer;
      const peerSyncMeta = this.network.getConnectedPeerSyncMeta(peerId);
      this.peerBalancer.onPeerConnected(data.peer, peerSyncMeta);
      this.triggerUnknownBlockSearch();
    } catch (e) {
      this.logger.debug("Error handling peerConnected event", {}, e as Error);
    }
  };

  private onPeerDisconnected = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    const peerId = data.peer;
    this.peerBalancer.onPeerDisconnected(peerId);
  };

  /**
   * Post-gloas, a locally complete block can still be blocked on its parent's execution payload lineage.
   * Distinguish which dependency is missing so the scheduler can enqueue the right follow-up work.
   */
  private getMissingBlockDependency(
    blockInput: IBlockInput
  ):
    | {kind: "ready"}
    | {kind: "block" | "parentBlock" | "parentPayload"; rootHex: RootHex}
    | {kind: "invalidParentPayload"; parentRootHex: RootHex; parentBlockHashHex: RootHex} {
    const parentRootHex = blockInput.parentRootHex;
    if (!this.chain.forkChoice.hasBlockHex(parentRootHex)) {
      return {kind: "parentBlock", rootHex: parentRootHex};
    }

    if (!blockInput.hasBlock()) {
      return {kind: "block", rootHex: blockInput.blockRootHex};
    }

    if (this.config.getForkSeq(blockInput.slot) < ForkSeq.gloas) {
      return {kind: "ready"};
    }

    const block = blockInput.getBlock() as gloas.SignedBeaconBlock;
    const parentBlockHashHex = toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash);
    if (this.chain.forkChoice.getBlockHexAndBlockHash(parentRootHex, parentBlockHashHex) !== null) {
      return {kind: "ready"};
    }

    if (this.chain.forkChoice.hasPayloadHexUnsafe(parentRootHex)) {
      return {kind: "invalidParentPayload", parentRootHex, parentBlockHashHex};
    }

    const parentPayloadInput = this.chain.seenPayloadEnvelopeInputCache.get(parentRootHex);
    if (parentPayloadInput) {
      if (parentPayloadInput.getBlockHashHex() === parentBlockHashHex) {
        return {kind: "parentPayload", rootHex: parentRootHex};
      }

      return {kind: "invalidParentPayload", parentRootHex, parentBlockHashHex};
    }

    return {kind: "parentPayload", rootHex: parentRootHex};
  }

  private advancePendingBlock(pendingBlock: PendingBlockInput): AdvancePendingBlockResult {
    const missingDependency = this.getMissingBlockDependency(pendingBlock.blockInput);

    switch (missingDependency.kind) {
      case "ready":
        return "ready";

      case "block":
        pendingBlock.status = PendingBlockInputStatus.pending;
        return "queued_block";

      case "parentBlock": {
        let added = this.addByRootHex(missingDependency.rootHex);
        for (const peerIdStr of pendingBlock.peerIdStrings) {
          added = this.addByRootHex(missingDependency.rootHex, peerIdStr) || added;
        }
        return added ? "queued_parent_block" : "blocked";
      }

      case "parentPayload": {
        let added = this.addByPayloadRootHex(missingDependency.rootHex);
        for (const peerIdStr of pendingBlock.peerIdStrings) {
          added = this.addByPayloadRootHex(missingDependency.rootHex, peerIdStr) || added;
        }
        return added ? "queued_parent_payload" : "blocked";
      }

      case "invalidParentPayload":
        this.logger.debug("Removing block with conflicting parent payload hash", {
          slot: pendingBlock.blockInput.slot,
          root: pendingBlock.blockInput.blockRootHex,
          parentRoot: missingDependency.parentRootHex,
          parentBlockHash: missingDependency.parentBlockHashHex,
        });
        this.removeAndDownScoreAllDescendants(pendingBlock);
        return "removed";
    }
  }

  private toPendingPayloadInput(
    payloadInput: PayloadEnvelopeInput,
    previous?: PayloadSyncCacheItem,
    envelope?: gloas.SignedExecutionPayloadEnvelope
  ): PendingPayloadInput {
    // Normalize every payload queueing path into the same cache shape while preserving first-seen
    // timing and peer provenance from any earlier by-root or envelope-only entry.
    const queuedEnvelope = envelope ?? (previous && isPendingPayloadEnvelope(previous) ? previous.envelope : undefined);

    if (queuedEnvelope && !payloadInput.hasPayloadEnvelope()) {
      payloadInput.addPayloadEnvelope({
        envelope: queuedEnvelope,
        source: PayloadEnvelopeInputSource.byRoot,
        seenTimestampSec: Date.now() / 1000,
      });
    }

    return {
      status: payloadInput.isComplete() ? PendingPayloadInputStatus.downloaded : PendingPayloadInputStatus.pending,
      payloadInput,
      timeAddedSec: previous?.timeAddedSec ?? Date.now() / 1000,
      timeSyncedSec: payloadInput.isComplete() ? Date.now() / 1000 : undefined,
      peerIdStrings: new Set(previous?.peerIdStrings ?? []),
    };
  }

  /**
   * Gather tip parent blocks with unknown parent and do a search for all of them
   */
  private triggerUnknownBlockSearch = (): void => {
    // Cheap early stop to prevent calling the network.getConnectedPeers()
    if (this.pendingBlocks.size === 0 && this.pendingPayloads.size === 0) {
      return;
    }

    // If the node loses all peers with pending unknown blocks or payloads, the sync will stall
    const connectedPeers = this.network.getConnectedPeers();
    const hasConnectedPeers = connectedPeers.length > 0;

    const {unknowns, ancestors} = getUnknownAndAncestorBlocks(this.pendingBlocks);
    let processedBlocks = 0;
    let shouldRerunBlockSearch = false;

    for (const block of ancestors) {
      const advanceResult = this.advancePendingBlock(block);
      switch (advanceResult) {
        case "ready":
          processedBlocks++;
          this.processReadyBlock(block).catch((e) => {
            this.logger.debug("Unexpected error - process old downloaded block", {}, e);
          });
          break;

        case "queued_block":
        case "queued_parent_block":
          shouldRerunBlockSearch = true;
          break;

        case "queued_parent_payload":
        case "blocked":
        case "removed":
          break;
      }
    }

    if (unknowns.length > 0) {
      if (!hasConnectedPeers) {
        this.logger.debug("No connected peers, skipping unknown block download.");
      } else {
        // Most of the time there is exactly 1 unknown block
        for (const block of unknowns) {
          this.downloadBlock(block).catch((e) => {
            this.logger.debug("Unexpected error - downloadBlock", {root: getBlockInputSyncCacheItemRootHex(block)}, e);
          });
        }
      }
    } else if (ancestors.length > 0) {
      // It's rare when there is no unknown block
      // see https://github.com/ChainSafe/lodestar/issues/5649#issuecomment-1594213550
      this.logger.verbose("No unknown block, process ancestor downloaded blocks", {
        pendingBlocks: this.pendingBlocks.size,
        ancestorBlocks: ancestors.length,
        processedBlocks,
      });
    }

    // Blocks can unblock payloads and payloads can unblock blocks, so every scheduler pass services both queues.
    for (const payload of Array.from(this.pendingPayloads.values())) {
      if (isPendingPayloadInput(payload) && payload.status === PendingPayloadInputStatus.downloaded) {
        this.processPayload(payload).catch((e) => {
          this.logger.debug("Unexpected error - process downloaded payload", {}, e);
        });
        continue;
      }

      if (isPendingPayloadEnvelope(payload)) {
        this.reconcilePayloadEnvelope(payload).catch((e) => {
          this.logger.debug("Unexpected error - reconcile pending payload envelope", {}, e);
        });
        continue;
      }

      if (!hasConnectedPeers) {
        this.logger.debug("No connected peers, skipping unknown payload download.", {
          root: getPayloadSyncCacheItemRootHex(payload),
        });
        continue;
      }

      this.downloadPayload(payload).catch((e) => {
        this.logger.debug("Unexpected error - downloadPayload", {root: getPayloadSyncCacheItemRootHex(payload)}, e);
      });
    }

    if (shouldRerunBlockSearch) {
      this.triggerUnknownBlockSearch();
    }
  };

  private async downloadBlock(block: BlockInputSyncCacheItem): Promise<void> {
    if (block.status !== PendingBlockInputStatus.pending) {
      return;
    }

    const rootHex = getBlockInputSyncCacheItemRootHex(block);
    const logCtx = {
      slot: getBlockInputSyncCacheItemSlot(block),
      root: rootHex,
      pendingBlocks: this.pendingBlocks.size,
    };

    this.logger.verbose("BlockInputSync.downloadBlock()", logCtx);

    block.status = PendingBlockInputStatus.fetching;

    const res = await wrapError(this.fetchBlockInput(block));

    if (!res.err) {
      this.metrics?.blockInputSync.downloadedBlocksSuccess.inc();
      const pending = res.result;
      this.pendingBlocks.set(pending.blockInput.blockRootHex, pending);
      const blockSlot = pending.blockInput.slot;
      const finalizedSlot = this.chain.forkChoice.getFinalizedBlock().slot;
      const delaySec = Date.now() / 1000 - computeTimeAtSlot(this.config, blockSlot, this.chain.genesisTime);
      this.metrics?.blockInputSync.elapsedTimeTillReceived.observe(delaySec);

      const parentInForkChoice = this.chain.forkChoice.hasBlockHex(pending.blockInput.parentRootHex);
      const logCtx2 = {
        ...logCtx,
        slot: blockSlot,
        parentInForkChoice,
      };
      this.logger.verbose("Downloaded unknown block", logCtx2);

      if (parentInForkChoice) {
        // If the direct parent is already in fork choice, let the block state machine decide if
        // the next step is block import, parent payload download, or branch removal.
        const advanceResult = this.advancePendingBlock(pending);
        switch (advanceResult) {
          case "ready":
            this.processReadyBlock(pending).catch((e) => {
              this.logger.debug("Unexpected error - process newly downloaded block", logCtx2, e);
            });
            break;

          case "queued_block":
          case "queued_parent_block":
          case "queued_parent_payload":
            this.triggerUnknownBlockSearch();
            break;

          case "blocked":
          case "removed":
            break;
        }
      } else if (blockSlot <= finalizedSlot) {
        // the common ancestor of the downloading chain and canonical chain should be at least the finalized slot and
        // we should found it through forkchoice. If not, we should penalize all peers sending us this block chain
        // 0 - 1 - ... - n - finalizedSlot
        //                \
        //                parent 1 - parent 2 - ... - unknownParent block
        this.logger.debug("Downloaded block is before finalized slot", {
          ...logCtx2,
          finalizedSlot,
        });
        this.removeAndDownScoreAllDescendants(block);
      } else {
        this.onUnknownBlockRoot({rootHex: pending.blockInput.parentRootHex, source: BlockInputSource.byRoot});
      }
    } else {
      this.metrics?.blockInputSync.downloadedBlocksError.inc();
      this.logger.debug("Ignoring unknown block root after many failed downloads", logCtx, res.err);
      this.removeAndDownScoreAllDescendants(block);
    }
  }

  /**
   * Import a block that has already passed the local dependency checks in BlockInputSync.
   * On error, remove and downscore descendants as appropriate for the failure type.
   */
  private async processReadyBlock(pendingBlock: PendingBlockInput): Promise<void> {
    if (pendingBlock.status !== PendingBlockInputStatus.downloaded) {
      return;
    }

    pendingBlock.status = PendingBlockInputStatus.processing;
    // this prevents unbundling attack
    // see https://lighthouse-blog.sigmaprime.io/mev-unbundling-rpc.html
    const {slot: blockSlot, proposerIndex} = pendingBlock.blockInput.getBlock().message;
    const fork = this.config.getForkName(blockSlot);
    const proposerBoostWindowMs = this.config.getAttestationDueMs(fork);
    if (
      this.chain.clock.msFromSlot(blockSlot) < proposerBoostWindowMs &&
      this.chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)
    ) {
      // proposer is known by a gossip block already, wait a bit to make sure this block is not
      // eligible for proposer boost to prevent unbundling attack
      this.logger.verbose("Avoid proposer boost for this block of known proposer", {
        slot: blockSlot,
        root: pendingBlock.blockInput.blockRootHex,
        proposerIndex,
      });
      await sleep(proposerBoostWindowMs);
    }
    // At gossip time, it's critical to keep a good number of mesh peers.
    // To do that, the Gossip Job Wait Time should be consistently <3s to avoid the behavior penalties in gossip
    // Gossip Job Wait Time depends on the BLS Job Wait Time
    // so `blsVerifyOnMainThread = true`: we want to verify signatures immediately without affecting the bls thread pool.
    // otherwise we can't utilize bls thread pool capacity and Gossip Job Wait Time can't be kept low consistently.
    // See https://github.com/ChainSafe/lodestar/issues/3792
    const res = await wrapError(
      this.chain.processBlock(pendingBlock.blockInput, {
        ignoreIfKnown: true,
        // there could be finalized/head sync at the same time so we need to ignore if finalized
        // see https://github.com/ChainSafe/lodestar/issues/5650
        ignoreIfFinalized: true,
        blsVerifyOnMainThread: true,
      })
    );

    if (res.err) this.metrics?.blockInputSync.processedBlocksError.inc();
    else this.metrics?.blockInputSync.processedBlocksSuccess.inc();

    if (!res.err) {
      // no need to update status to "processed", delete anyway
      this.pendingBlocks.delete(pendingBlock.blockInput.blockRootHex);
      // Re-enter the scheduler so descendants blocked on either parent blocks or parent payloads
      // are advanced through the same dependency checks as every other pending item.
      this.triggerUnknownBlockSearch();
    } else {
      const errorData = {slot: pendingBlock.blockInput.slot, root: pendingBlock.blockInput.blockRootHex};
      if (res.err instanceof BlockError) {
        switch (res.err.type.code) {
          // This cases are already handled with `{ignoreIfKnown: true}`
          // case BlockErrorCode.ALREADY_KNOWN:
          // case BlockErrorCode.GENESIS_BLOCK:

          case BlockErrorCode.PARENT_UNKNOWN:
          case BlockErrorCode.PRESTATE_MISSING:
            // Should not happen, mark as downloaded to try again latter
            this.logger.debug("Attempted to process block but its parent was still unknown", errorData, res.err);
            pendingBlock.status = PendingBlockInputStatus.downloaded;
            break;

          case BlockErrorCode.PARENT_PAYLOAD_UNKNOWN:
            this.logger.error(
              "processReadyBlock() hit unexpected parent payload dependency after readiness checks",
              {
                ...errorData,
                parentRoot: pendingBlock.blockInput.parentRootHex,
                parentBlockHash: res.err.type.parentBlockHash,
              },
              res.err
            );
            pendingBlock.status = PendingBlockInputStatus.downloaded;
            break;

          case BlockErrorCode.EXECUTION_ENGINE_ERROR:
            // Removing the block(s) without penalizing the peers, hoping for EL to
            // recover on a latter download + verify attempt
            this.removeAllDescendants(pendingBlock);
            break;

          default:
            // Block is not correct with respect to our chain. Log error loudly
            this.logger.debug("Error processing block from unknown parent sync", errorData, res.err);
            this.removeAndDownScoreAllDescendants(pendingBlock);
        }
      }

      // Probably a queue error or something unwanted happened, mark as pending to try again latter
      else {
        this.logger.debug("Unknown error processing block from unknown block sync", errorData, res.err);
        pendingBlock.status = PendingBlockInputStatus.downloaded;
      }
    }
  }

  /**
   * Reconcile an envelope-first payload entry once the block import path has seeded its
   * PayloadEnvelopeInput. This may queue block download, validate the speculative envelope, or
   * downgrade back to by-root fetching when the cached envelope does not match the imported block.
   */
  private async reconcilePayloadEnvelope(pendingPayload: PendingPayloadEnvelope): Promise<void> {
    const rootHex = getPayloadSyncCacheItemRootHex(pendingPayload);
    if (this.chain.forkChoice.hasPayloadHexUnsafe(rootHex)) {
      this.pendingPayloads.delete(rootHex);
      return;
    }

    const payloadInput = this.chain.seenPayloadEnvelopeInputCache.get(rootHex);
    if (!payloadInput) {
      if (!this.chain.forkChoice.hasBlockHex(rootHex)) {
        // Column commitments live on the block body, so an envelope-only entry has to pull the block first.
        if (!this.pendingBlocks.has(rootHex)) {
          this.addByRootHex(rootHex);
        }

        const pendingBlock = this.pendingBlocks.get(rootHex);
        if (pendingBlock && this.network.getConnectedPeers().length > 0) {
          await this.downloadBlock(pendingBlock);
        }
      } else {
        this.logger.debug("Missing PayloadEnvelopeInput for known block while reconciling payload envelope", {
          root: rootHex,
        });
      }
      return;
    }

    if (!payloadInput.hasPayloadEnvelope()) {
      const validationResult = await wrapError(
        validateGossipExecutionPayloadEnvelope(this.chain, pendingPayload.envelope, {ignoreIfKnown: true})
      );
      if (validationResult.err) {
        this.logger.debug(
          "Pending payload envelope failed validation after block import, refetching by root",
          {slot: pendingPayload.envelope.message.payload.slotNumber, root: rootHex},
          validationResult.err
        );

        const pendingPayloadByRoot: PendingPayloadRootHex = {
          status: PendingPayloadInputStatus.pending,
          rootHex,
          timeAddedSec: pendingPayload.timeAddedSec,
          peerIdStrings: new Set(pendingPayload.peerIdStrings),
        };
        this.pendingPayloads.set(rootHex, pendingPayloadByRoot);

        if (this.network.getConnectedPeers().length > 0) {
          await this.downloadPayload(pendingPayloadByRoot);
        }
        return;
      }
    }

    const upgradedPayload = this.toPendingPayloadInput(payloadInput, pendingPayload, pendingPayload.envelope);
    this.pendingPayloads.set(rootHex, upgradedPayload);

    if (upgradedPayload.status === PendingPayloadInputStatus.downloaded) {
      await this.processPayload(upgradedPayload);
      return;
    }

    await this.downloadPayload(upgradedPayload);
  }

  private async downloadPayload(payload: PayloadSyncCacheItem): Promise<void> {
    if (isPendingPayloadEnvelope(payload)) {
      await this.reconcilePayloadEnvelope(payload);
      return;
    }

    const rootHex = getPayloadSyncCacheItemRootHex(payload);
    if (this.chain.forkChoice.hasPayloadHexUnsafe(rootHex)) {
      this.pendingPayloads.delete(rootHex);
      return;
    }

    if (payload.status !== PendingPayloadInputStatus.pending) {
      return;
    }

    const logCtx = {
      slot: getPayloadSyncCacheItemSlot(payload),
      root: rootHex,
      pendingPayloads: this.pendingPayloads.size,
    };

    this.logger.verbose("BlockInputSync.downloadPayload()", logCtx);

    payload.status = PendingPayloadInputStatus.fetching;

    const res = await wrapError(this.fetchPayloadInput(payload));
    if (!res.err) {
      const pendingPayload = res.result;
      this.pendingPayloads.set(getPayloadSyncCacheItemRootHex(pendingPayload), pendingPayload);

      if (isPendingPayloadEnvelope(pendingPayload)) {
        await this.reconcilePayloadEnvelope(pendingPayload);
      } else if (pendingPayload.status === PendingPayloadInputStatus.downloaded) {
        await this.processPayload(pendingPayload);
      }
      return;
    }

    this.logger.debug("Ignoring unknown payload root after failed download", logCtx, res.err);
    if (!isPendingPayloadEnvelope(payload)) {
      payload.status = PendingPayloadInputStatus.pending;
    }
  }

  private async processPayload(pendingPayload: PendingPayloadInput): Promise<void> {
    const rootHex = pendingPayload.payloadInput.blockRootHex;
    const logCtx = {slot: pendingPayload.payloadInput.slot, root: rootHex};

    if (pendingPayload.status !== PendingPayloadInputStatus.downloaded) {
      this.logger.debug("Skipping payload processing before payload input is downloaded", {
        ...logCtx,
        status: pendingPayload.status,
      });
      return;
    }

    if (this.chain.forkChoice.hasPayloadHexUnsafe(rootHex)) {
      this.logger.debug("Payload already imported while processing unknown payload", logCtx);
      this.pendingPayloads.delete(rootHex);
      return;
    }

    if (!this.chain.forkChoice.hasBlockHex(rootHex)) {
      this.logger.debug("Payload input is ready before its block is in fork choice", logCtx);
      const added = this.addByRootHex(rootHex);
      pendingPayload.status = PendingPayloadInputStatus.downloaded;
      if (added) {
        this.triggerUnknownBlockSearch();
      }
      return;
    }

    pendingPayload.status = PendingPayloadInputStatus.processing;

    const res = await wrapError(this.chain.processExecutionPayload(pendingPayload.payloadInput));
    if (!res.err) {
      this.logger.debug("Processed payload from unknown sync", logCtx);
      this.pendingPayloads.delete(rootHex);
      this.triggerUnknownBlockSearch();
      return;
    }

    if (res.err instanceof PayloadError) {
      switch (res.err.type.code) {
        case PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE:
          // Payload sync discovered the block dependency before the block queue did. Re-enqueue the
          // block and keep the payload ready so the scheduler can retry once the block reaches fork choice.
          if (this.addByRootHex(rootHex)) {
            this.triggerUnknownBlockSearch();
          }
          // Keep the payload out of any synchronous requeue pass; a later scheduler pass will retry it.
          pendingPayload.status = PendingPayloadInputStatus.downloaded;
          break;

        case PayloadErrorCode.EXECUTION_ENGINE_ERROR:
          this.logger.debug("Execution engine error while processing payload from unknown sync", logCtx, res.err);
          pendingPayload.status = PendingPayloadInputStatus.downloaded;
          break;

        case PayloadErrorCode.EXECUTION_ENGINE_INVALID:
        case PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR:
        case PayloadErrorCode.INVALID_SIGNATURE:
          // TODO GLOAS: Decide how invalid payload inputs should eventually leave memory without
          // reintroducing envelope replacement / recreation flows.
          this.logger.debug("Error processing payload from unknown sync", logCtx, res.err);
          this.removePendingPayloadAndDescendants(rootHex);
          break;

        default:
          this.logger.debug("Error processing payload from unknown sync", logCtx, res.err);
          this.pendingPayloads.delete(rootHex);
      }
      return;
    }

    this.logger.debug("Unknown error processing payload from unknown sync", logCtx, res.err);
    pendingPayload.status = PendingPayloadInputStatus.downloaded;
  }

  /**
   * Download payload material keyed by beacon block root. Unlike block download, payload sync may
   * already have a locally cached envelope or partial columns, so each attempt starts from local state
   * and only asks peers for the remaining pieces.
   */
  private async fetchPayloadInput(
    cacheItem: PendingPayloadInput | PendingPayloadRootHex
  ): Promise<PendingPayloadInput | PendingPayloadEnvelope> {
    const rootHex = getPayloadSyncCacheItemRootHex(cacheItem);
    const blockRoot = fromHex(rootHex);
    const excludedPeers = new Set<PeerIdStr>();

    let slot = getPayloadSyncCacheItemSlot(cacheItem);
    let payloadInput = isPendingPayloadInput(cacheItem)
      ? cacheItem.payloadInput
      : this.chain.seenPayloadEnvelopeInputCache.get(rootHex);
    let envelope = payloadInput?.hasPayloadEnvelope() ? payloadInput.getPayloadEnvelope() : undefined;

    let i = 0;
    while (i++ < this.getMaxDownloadAttempts()) {
      const pendingColumns = payloadInput?.hasAllData()
        ? new Set<number>()
        : new Set(payloadInput?.getMissingSampledColumnMeta().missing ?? []);
      const peerMeta = this.peerBalancer.bestPeerForPendingColumns(pendingColumns, excludedPeers);
      if (peerMeta === null) {
        throw Error(
          `Error fetching payload by root slot=${slot} root=${rootHex} after ${i}: cannot find peer with needed columns=${prettyPrintIndices(Array.from(pendingColumns))}`
        );
      }

      const {peerId, client: peerClient} = peerMeta;
      cacheItem.peerIdStrings.add(peerId);

      try {
        if (!envelope) {
          envelope = await this.fetchExecutionPayloadEnvelope(peerId, blockRoot, rootHex);
          slot = envelope.message.payload.slotNumber;
        }

        payloadInput ??= this.chain.seenPayloadEnvelopeInputCache.get(rootHex);
        if (!payloadInput) {
          if (this.chain.forkChoice.hasBlockHex(rootHex)) {
            throw new Error(`Missing PayloadEnvelopeInput for known block ${rootHex}`);
          }
          // Keep the validated envelope around, but wait for the block body before turning it into a full payload input.
          return {
            status: PendingPayloadInputStatus.waitingForBlock,
            envelope,
            timeAddedSec: cacheItem.timeAddedSec,
            peerIdStrings: cacheItem.peerIdStrings,
          };
        }

        if (!payloadInput.hasPayloadEnvelope()) {
          await validateGossipExecutionPayloadEnvelope(this.chain, envelope, {ignoreIfKnown: true});
        }

        let pendingPayload = this.toPendingPayloadInput(payloadInput, cacheItem, envelope);
        if (!pendingPayload.payloadInput.hasAllData()) {
          const missing = pendingPayload.payloadInput.getMissingSampledColumnMeta().missing;
          if (missing.length > 0) {
            const columnSidecars = await this.fetchPayloadColumns(peerMeta, pendingPayload.payloadInput, missing);
            const seenTimestampSec = Date.now() / 1000;
            for (const columnSidecar of columnSidecars) {
              if (pendingPayload.payloadInput.hasColumn(columnSidecar.index)) {
                continue;
              }

              pendingPayload.payloadInput.addColumn({
                columnSidecar,
                source: PayloadEnvelopeInputSource.byRoot,
                seenTimestampSec,
                peerIdStr: peerId,
              });
            }
            pendingPayload = this.toPendingPayloadInput(pendingPayload.payloadInput, pendingPayload);
          }
        }

        this.logger.verbose("BlockInputSync.fetchPayloadInput: successful download", {
          slot,
          rootHex,
          peerId,
          peerClient,
          hasPayload: pendingPayload.payloadInput.hasPayloadEnvelope(),
          hasAllData: pendingPayload.payloadInput.hasAllData(),
        });

        if (pendingPayload.status === PendingPayloadInputStatus.downloaded) {
          return pendingPayload;
        }

        cacheItem = pendingPayload;
        payloadInput = pendingPayload.payloadInput;
      } catch (e) {
        this.logger.debug(
          "Error downloading payload in BlockInputSync.fetchPayloadInput",
          {slot, rootHex, attempt: i, peer: peerId, peerClient},
          e as Error
        );

        if (e instanceof RequestError) {
          switch (e.type.code) {
            case RequestErrorCode.REQUEST_RATE_LIMITED:
            case RequestErrorCode.REQUEST_TIMEOUT:
              break;
            default:
              excludedPeers.add(peerId);
              break;
          }
        } else {
          excludedPeers.add(peerId);
        }
      } finally {
        this.peerBalancer.onRequestCompleted(peerId);
      }
    }

    throw Error(`Error fetching payload with slot=${slot} root=${rootHex} after ${i - 1} attempts.`);
  }

  private async fetchExecutionPayloadEnvelope(
    peerIdStr: PeerIdStr,
    blockRoot: Uint8Array,
    rootHex: RootHex
  ): Promise<gloas.SignedExecutionPayloadEnvelope> {
    const response = await this.network.sendExecutionPayloadEnvelopesByRoot(peerIdStr, [blockRoot]);
    const envelope = response.at(0);
    if (!envelope) {
      throw new Error(`Missing execution payload envelope for root=${rootHex}`);
    }

    const receivedRootHex = toRootHex(envelope.message.beaconBlockRoot);
    if (receivedRootHex !== rootHex) {
      throw new Error(`Execution payload envelope root mismatch requested=${rootHex} received=${receivedRootHex}`);
    }

    return envelope;
  }

  private async fetchPayloadColumns(
    peerMeta: PeerSyncMeta,
    payloadInput: PayloadEnvelopeInput,
    missing: number[]
  ): Promise<gloas.DataColumnSidecar[]> {
    const {peerId: peerIdStr} = peerMeta;
    const peerColumns = new Set(peerMeta.custodyColumns ?? []);
    const requestedColumns = missing.filter((columnIndex) => peerColumns.has(columnIndex));
    if (requestedColumns.length === 0) {
      return [];
    }

    const columnSidecars = (await this.network.sendDataColumnSidecarsByRoot(peerIdStr, [
      {blockRoot: fromHex(payloadInput.blockRootHex), columns: requestedColumns},
    ])) as gloas.DataColumnSidecar[];

    if (columnSidecars.length === 0) {
      throw new Error(`No data column sidecars returned for payload root=${payloadInput.blockRootHex}`);
    }

    const requestedColumnsSet = new Set(requestedColumns);
    const extraColumns = columnSidecars.filter((columnSidecar) => !requestedColumnsSet.has(columnSidecar.index));
    if (extraColumns.length > 0) {
      throw new Error(
        `Received unexpected payload data columns indices=${prettyPrintIndices(extraColumns.map((column) => column.index))}`
      );
    }

    // PayloadEnvelopeInput already carries the block slot, root, and commitments, so reuse the
    // block-based Gloas validator rather than maintaining a second payload-specific variant.
    await validateGloasBlockDataColumnSidecars(
      payloadInput.slot,
      fromHex(payloadInput.blockRootHex),
      payloadInput.getBlobKzgCommitments(),
      columnSidecars,
      this.chain.metrics?.peerDas
    );
    return columnSidecars;
  }

  /**
   * From a set of shuffled peers:
   *   - fetch the block
   *   - from deneb, fetch all missing blobs
   *   - from peerDAS, fetch sampled columns
   * TODO: this means we only have block root, and nothing else. Consider to reflect this in the function name
   * prefulu, will attempt a max of `MAX_ATTEMPTS_PER_BLOCK` on different peers, postfulu we may attempt more as defined in `getMaxDownloadAttempts()` function
   * Also verifies the received block root + returns the peer that provided the block for future downscoring.
   */
  private async fetchBlockInput(cacheItem: BlockInputSyncCacheItem): Promise<PendingBlockInput> {
    const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
    const excludedPeers = new Set<PeerIdStr>();
    const defaultPendingColumns = new Set(this.network.custodyConfig.sampledColumns);

    const fetchStartSec = Date.now() / 1000;
    let slot = isPendingBlockInput(cacheItem) ? cacheItem.blockInput.slot : undefined;
    if (slot !== undefined) {
      this.metrics?.blockInputSync.fetchBegin.observe(this.chain.clock.secFromSlot(slot, fetchStartSec));
    }

    let i = 0;
    while (i++ < this.getMaxDownloadAttempts()) {
      const pendingColumns =
        isPendingBlockInput(cacheItem) && isBlockInputColumns(cacheItem.blockInput)
          ? new Set(cacheItem.blockInput.getMissingSampledColumnMeta().missing)
          : defaultPendingColumns;
      const peerMeta = this.peerBalancer.bestPeerForPendingColumns(pendingColumns, excludedPeers);
      if (peerMeta === null) {
        // no more peer with needed columns to try, throw error
        const message = `Error fetching UnknownBlockRoot slot=${slot} root=${rootHex} after ${i}: cannot find peer with needed columns=${prettyPrintIndices(Array.from(pendingColumns))}`;
        this.metrics?.blockInputSync.fetchTimeSec.observe(
          {result: FetchResult.FailureTriedAllPeers},
          Date.now() / 1000 - fetchStartSec
        );
        this.metrics?.blockInputSync.fetchPeers.set({result: FetchResult.FailureTriedAllPeers}, i);
        throw Error(message);
      }
      const {peerId, client: peerClient} = peerMeta;

      cacheItem.peerIdStrings.add(peerId);

      try {
        const downloadResult = await downloadByRoot({
          config: this.config,
          network: this.network,
          chain: this.chain,
          emitter: this.chain.emitter,
          peerMeta,
          cacheItem,
        });
        cacheItem = downloadResult.result;
        if (slot === undefined) {
          slot = cacheItem.blockInput.slot;
          // we were not able to observe the time into slot when starting the fetch, do it now
          this.metrics?.blockInputSync.fetchBegin.observe(this.chain.clock.secFromSlot(slot, fetchStartSec));
        }

        const logCtx = {slot, rootHex, peerId, peerClient};
        this.logger.verbose("BlockInputSync.fetchBlockInput: successful download", logCtx);
        this.metrics?.blockInputSync.downloadByRoot.success.inc();
        const warnings = downloadResult.warnings;
        if (warnings) {
          for (const warning of warnings) {
            this.logger.debug("BlockInputSync.fetchBlockInput: downloaded with warning", logCtx, warning);
            this.metrics?.blockInputSync.downloadByRoot.warn.inc({code: warning.type.code, client: peerClient});
          }
          // TODO: penalize peer?
        }
      } catch (e) {
        this.logger.debug(
          "Error downloading in BlockInputSync.fetchBlockInput",
          {slot, rootHex, attempt: i, peer: peerId, peerClient},
          e as Error
        );
        const downloadByRootMetrics = this.metrics?.blockInputSync.downloadByRoot;
        // TODO: penalize peer?
        if (e instanceof DownloadByRootError) {
          const errorCode = e.type.code;
          downloadByRootMetrics?.error.inc({code: errorCode, client: peerClient});
          excludedPeers.add(peerId);
        } else if (e instanceof RequestError) {
          // should look into req_resp metrics in this case
          downloadByRootMetrics?.error.inc({code: "req_resp", client: peerClient});
          switch (e.type.code) {
            case RequestErrorCode.REQUEST_RATE_LIMITED:
            case RequestErrorCode.REQUEST_TIMEOUT:
              // do not exclude peer for these errors
              break;
            default:
              excludedPeers.add(peerId);
              break;
          }
        } else {
          // investigate if this happens
          downloadByRootMetrics?.error.inc({code: "unknown", client: peerClient});
          excludedPeers.add(peerId);
        }
      } finally {
        this.peerBalancer.onRequestCompleted(peerId);
      }

      this.pendingBlocks.set(getBlockInputSyncCacheItemRootHex(cacheItem), cacheItem);

      if (cacheItem.status === PendingBlockInputStatus.downloaded) {
        // download was successful, no need to go with another peer, return
        const result = this.chain.forkChoice.hasBlockHex(cacheItem.blockInput.blockRootHex)
          ? FetchResult.SuccessLate
          : this.chain.forkChoice.hasBlockHex(cacheItem.blockInput.parentRootHex)
            ? FetchResult.SuccessResolved
            : FetchResult.SuccessMissingParent;
        this.metrics?.blockInputSync.fetchTimeSec.observe({result}, Date.now() / 1000 - fetchStartSec);
        this.metrics?.blockInputSync.fetchPeers.set({result}, i);
        return cacheItem;
      }
    } // end while loop over peers

    const message = `Error fetching BlockInput with slot=${slot} root=${rootHex} after ${i - 1} attempts.`;

    if (!isPendingBlockInput(cacheItem)) {
      throw Error(`${message} No block and no data was found.`);
    }

    if (!cacheItem.blockInput.hasBlock()) {
      throw new Error(`${message} Block was not found.`);
    }

    if (isBlockInputBlobs(cacheItem.blockInput)) {
      const missing = cacheItem.blockInput.getMissingBlobMeta().map((b) => b.index);
      if (missing.length) {
        throw new Error(`${message} Missing blob indices=${prettyPrintIndices(missing)}.`);
      }
    }

    if (isBlockInputColumns(cacheItem.blockInput)) {
      const missing = cacheItem.blockInput.getMissingSampledColumnMeta().missing;
      if (missing.length) {
        throw new Error(`${message} Missing column indices=${prettyPrintIndices(missing)}.`);
      }
    }

    this.metrics?.blockInputSync.fetchTimeSec.observe(
      {result: FetchResult.FailureMaxAttempts},
      Date.now() / 1000 - fetchStartSec
    );
    this.metrics?.blockInputSync.fetchPeers.set({result: FetchResult.FailureMaxAttempts}, i - 1);

    throw Error(message);
  }

  /**
   * Gets all descendant blocks of `block` recursively from `pendingBlocks`.
   * Assumes that if a parent block does not exist or is not processable, all descendant blocks are bad too.
   * Downscore all peers that have referenced any of this bad blocks. May report peers multiple times if they have
   * referenced more than one bad block.
   */
  private removeAndDownScoreAllDescendants(block: BlockInputSyncCacheItem): void {
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = this.removeAllDescendants(block);
    // just console log and do not penalize on pending/bad blocks for debugging
    // console.log("removeAndDownscoreAllDescendants", {block});

    for (const block of badPendingBlocks) {
      //
      // TODO(fulu): why is this commented out here?
      //
      //   this.knownBadBlocks.add(block.blockRootHex);
      //   for (const peerIdStr of block.peerIdStrings) {
      //     // TODO: Refactor peerRpcScores to work with peerIdStr only
      //     this.network.reportPeer(peerIdStr, PeerAction.LowToleranceError, "BadBlockByRoot");
      //   }
      this.logger.debug("ignored Banning unknown block", {
        slot: getBlockInputSyncCacheItemSlot(block),
        root: getBlockInputSyncCacheItemRootHex(block),
        peerIdStrings: Array.from(block.peerIdStrings)
          .map((id) => prettyPrintPeerIdStr(id))
          .join(","),
      });
    }

    // Prune knownBadBlocks
    pruneSetToMax(this.knownBadBlocks, MAX_KNOWN_BAD_BLOCKS);
  }

  // Once a parent payload is invalid, every descendant waiting on that payload lineage becomes unrecoverable too.
  private removePendingPayloadAndDescendants(rootHex: RootHex): void {
    // Keep PayloadEnvelopeInput resident in the seen cache. importBlock() owns that object and
    // later validation/finalization logic decides when it can leave memory.
    this.pendingPayloads.delete(rootHex);

    const badPendingBlocks = getAllDescendantBlocks(rootHex, this.pendingBlocks);
    this.metrics?.blockInputSync.removedBlocks.inc(badPendingBlocks.length);

    for (const block of badPendingBlocks) {
      const descendantRootHex = getBlockInputSyncCacheItemRootHex(block);
      this.pendingBlocks.delete(descendantRootHex);
      this.pendingPayloads.delete(descendantRootHex);
      this.chain.seenBlockInputCache.prune(descendantRootHex);
      this.logger.debug("Removing pending descendant after invalid parent payload", {
        slot: getBlockInputSyncCacheItemSlot(block),
        blockRoot: descendantRootHex,
        parentPayloadRoot: rootHex,
      });
    }
  }

  private removeAllDescendants(block: BlockInputSyncCacheItem): BlockInputSyncCacheItem[] {
    const rootHex = getBlockInputSyncCacheItemRootHex(block);
    const slot = getBlockInputSyncCacheItemSlot(block);
    // Get all blocks that are a descendant of this one
    const badPendingBlocks = [block, ...getAllDescendantBlocks(rootHex, this.pendingBlocks)];

    this.metrics?.blockInputSync.removedBlocks.inc(badPendingBlocks.length);

    for (const block of badPendingBlocks) {
      const rootHex = getBlockInputSyncCacheItemRootHex(block);
      this.pendingBlocks.delete(rootHex);
      this.pendingPayloads.delete(rootHex);
      this.chain.seenBlockInputCache.prune(rootHex);
      // Keep PayloadEnvelopeInput resident in the seen cache for consistency with the
      // importBlock()-owned lifecycle.
      this.logger.debug("Removing bad/unknown/incomplete BlockInputSyncCacheItem", {
        slot,
        blockRoot: rootHex,
      });
    }

    return badPendingBlocks;
  }

  private getMaxDownloadAttempts(): number {
    if (this.config.getForkSeq(this.chain.clock.currentSlot) < ForkSeq.fulu) {
      return MAX_ATTEMPTS_PER_BLOCK;
    }

    // TODO: I consider max 20 downloads per block for a supernode is enough for devnets
    // review this computation for public testnets or mainnet
    return Math.min(
      20,
      (MAX_ATTEMPTS_PER_BLOCK * this.network.custodyConfig.sampleGroups.length) / this.config.SAMPLES_PER_SLOT
    );
  }
}

/**
 * Class to track active byRoots requests and balance them across eligible peers.
 */
export class UnknownBlockPeerBalancer {
  readonly peersMeta: Map<PeerIdStr, PeerSyncMeta>;
  readonly activeRequests: Map<PeerIdStr, number>;

  constructor() {
    this.peersMeta = new Map();
    this.activeRequests = new Map();
  }

  /** Trigger on each peer re-status */
  onPeerConnected(peerId: PeerIdStr, syncMeta: PeerSyncMeta): void {
    this.peersMeta.set(peerId, syncMeta);

    if (!this.activeRequests.has(peerId)) {
      this.activeRequests.set(peerId, 0);
    }
  }

  onPeerDisconnected(peerId: PeerIdStr): void {
    this.peersMeta.delete(peerId);
    this.activeRequests.delete(peerId);
  }

  /**
   * called from fetchBlockInput() where we only have block root and nothing else
   * excludedPeers are the peers that we requested already so we don't want to try again
   * pendingColumns is empty for prefulu, or the 1st time we we download a block by root
   */
  bestPeerForPendingColumns(pendingColumns: Set<number>, excludedPeers: Set<PeerIdStr>): PeerSyncMeta | null {
    const eligiblePeers = this.filterPeers(pendingColumns, excludedPeers);
    if (eligiblePeers.length === 0) {
      return null;
    }

    const sortedEligiblePeers = sortBy(
      shuffle(eligiblePeers),
      // prefer peers with least active req
      (peerId) => this.activeRequests.get(peerId) ?? 0
    );

    const bestPeerId = sortedEligiblePeers[0];
    this.onRequest(bestPeerId);
    return this.peersMeta.get(bestPeerId) ?? null;
  }

  /**
   * Consumers don't need to call this method directly, it is called internally by bestPeer*() methods
   * make this public for testing
   */
  onRequest(peerId: PeerIdStr): void {
    this.activeRequests.set(peerId, (this.activeRequests.get(peerId) ?? 0) + 1);
  }

  /**
   * Consumers should call this method when a request is completed for a peer.
   */
  onRequestCompleted(peerId: PeerIdStr): void {
    this.activeRequests.set(peerId, Math.max(0, (this.activeRequests.get(peerId) ?? 1) - 1));
  }

  getTotalActiveRequests(): number {
    let totalActiveRequests = 0;
    for (const count of this.activeRequests.values()) {
      totalActiveRequests += count;
    }
    return totalActiveRequests;
  }

  private filterPeers(pendingDataColumns: Set<number>, excludedPeers: Set<PeerIdStr>): PeerIdStr[] {
    let maxColumnCount = 0;
    const considerPeers: {peerId: PeerIdStr; columnCount: number}[] = [];
    for (const [peerId, syncMeta] of this.peersMeta.entries()) {
      if (excludedPeers.has(peerId)) {
        // made request to this peer already
        continue;
      }

      const activeRequests = this.activeRequests.get(peerId) ?? 0;
      if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        // should return peer with no more than MAX_CONCURRENT_REQUESTS active requests
        continue;
      }

      if (pendingDataColumns.size === 0) {
        considerPeers.push({peerId, columnCount: 0});
        continue;
      }

      // find peers that have custody columns that we need
      const {custodyColumns: peerColumns} = syncMeta;
      // check if the peer has all needed columns
      // get match
      const columns = peerColumns.reduce((acc, elem) => {
        if (pendingDataColumns.has(elem)) {
          acc.push(elem);
        }
        return acc;
      }, [] as number[]);

      if (columns.length > 0) {
        if (columns.length > maxColumnCount) {
          maxColumnCount = columns.length;
        }
        considerPeers.push({peerId, columnCount: columns.length});
      }
    } // end for

    const eligiblePeers: PeerIdStr[] = [];
    for (const {peerId, columnCount} of considerPeers) {
      if (columnCount === maxColumnCount) {
        eligiblePeers.push(peerId);
      }
    }

    return eligiblePeers;
  }
}
