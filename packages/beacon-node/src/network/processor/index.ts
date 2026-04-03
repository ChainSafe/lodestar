import {routes} from "@lodestar/api";
import {ForkSeq} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, Slot, SlotRootHex} from "@lodestar/types";
import {Logger, MapDef, mapValues, sleep} from "@lodestar/utils";
import {BlockInputSource} from "../../chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../chain/emitter.js";
import {GossipErrorCode} from "../../chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../chain/interface.js";
import {IBeaconDb} from "../../db/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {ClockEvent} from "../../util/clock.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {PeerIdStr} from "../../util/peerId.js";
import {
  getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized,
  getDataIndexFromSignedAggregateAndProofSerialized,
  getDataIndexFromSingleAttestationSerialized,
  getParentBlockHashFromGloasSignedBeaconBlockSerialized,
  getParentBlockHashFromSignedExecutionPayloadBidSerialized,
  getParentBlockRootFromSignedExecutionPayloadBidSerialized,
  getParentRootFromSignedBeaconBlockSerialized,
  getPayloadPresentFromPayloadAttestationMessageSerialized,
} from "../../util/sszBytes.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {
  GossipHandlers,
  GossipMessageInfo,
  GossipType,
  GossipValidatorBatchFn,
  GossipValidatorFn,
} from "../gossip/interface.js";
import {createExtractBlockSlotRootFns} from "./extractSlotRootFns.js";
import {GossipHandlerOpts, ValidatorFnsModules, getGossipHandlers} from "./gossipHandlers.js";
import {createGossipQueues} from "./gossipQueues/index.js";
import {ValidatorFnModules, getGossipValidatorBatchFn, getGossipValidatorFn} from "./gossipValidatorFn.js";
import {PendingGossipsubMessage} from "./types.js";

export * from "./types.js";

export type NetworkProcessorModules = ValidatorFnsModules &
  ValidatorFnModules & {
    chain: IBeaconChain;
    db: IBeaconDb;
    events: NetworkEventBus;
    logger: Logger;
    metrics: Metrics | null;
    // Optionally pass custom GossipHandlers, for testing
    gossipHandlers?: GossipHandlers;
  };

export type NetworkProcessorOpts = GossipHandlerOpts & {
  maxGossipTopicConcurrency?: number;
};

/**
 * Keep up to 3 slot of unknown roots, so we don't always emit to UnknownBlock sync.
 */
const MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE = 3;

/**
 * This is respective to gossipsub seenTTL (which is 550 * 0.7 = 385s), also it's respective
 * to beacon_attestation ATTESTATION_PROPAGATION_SLOT_RANGE (32 slots).
 * If message slots are within this window, it'll likely to be filtered by gossipsub seenCache.
 * This is mainly for DOS protection, see https://github.com/ChainSafe/lodestar/issues/5393
 */
const DEFAULT_EARLIEST_PERMISSIBLE_SLOT_DISTANCE = 32;

type WorkOpts = {
  bypassQueue?: boolean;
};

/**
 * True if we want to process gossip object immediately, false if we check for bls and regen
 * in order to process the gossip object.
 */
const executeGossipWorkOrderObj: Record<GossipType, WorkOpts> = {
  [GossipType.beacon_block]: {bypassQueue: true},
  [GossipType.blob_sidecar]: {bypassQueue: true},
  [GossipType.data_column_sidecar]: {bypassQueue: true},
  [GossipType.beacon_aggregate_and_proof]: {},
  [GossipType.voluntary_exit]: {},
  [GossipType.bls_to_execution_change]: {},
  [GossipType.beacon_attestation]: {},
  [GossipType.proposer_slashing]: {},
  [GossipType.attester_slashing]: {},
  [GossipType.sync_committee_contribution_and_proof]: {},
  [GossipType.sync_committee]: {},
  [GossipType.light_client_finality_update]: {},
  [GossipType.light_client_optimistic_update]: {},
  [GossipType.execution_payload]: {bypassQueue: true},
  [GossipType.payload_attestation_message]: {},
  [GossipType.execution_payload_bid]: {},
};
const executeGossipWorkOrder = Object.keys(executeGossipWorkOrderObj) as (keyof typeof executeGossipWorkOrderObj)[];

// TODO: Arbitrary constant, check metrics
const MAX_JOBS_SUBMITTED_PER_TICK = 128;

// How many gossip messages we keep before new ones get dropped.
const MAX_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS = 16_384;
// TODO gloas: arbitrary constant, check metrics.
const MAX_QUEUED_UNKNOWN_PAYLOAD_GOSSIP_OBJECTS = 1024;

// We don't want to process too many gossip messages in a single tick
// As seen on mainnet, gossip messages concurrency metric ranges from 1000 to 2000
// so make this constant a little bit conservative
const MAX_AWAITING_GOSSIP_OBJECTS_PER_TICK = 1024;

// Same motivation to JobItemQueue, we don't want to block the event loop
const AWAITING_GOSSIP_OBJECTS_YIELD_EVERY_MS = 50;

/**
 * Reprocess reject reason for metrics
 */
export enum ReprocessRejectReason {
  /**
   * There are too many gossip messages that have unknown block root.
   */
  reached_limit = "reached_limit",
  /**
   * The awaiting gossip message is pruned per clock slot.
   */
  expired = "expired",
}

/**
 * Cannot accept work reason for metrics
 */
export enum CannotAcceptWorkReason {
  /**
   * bls is busy.
   */
  bls = "bls_busy",
  /**
   * regen is busy.
   */
  regen = "regen_busy",
}

/**
 * No metrics needed here; using a number to keep it lightweight
 */
enum PreprocessAction {
  AwaitBlock,
  AwaitEnvelope,
  PushToQueue,
}

type PreprocessResult =
  | {action: PreprocessAction.PushToQueue}
  | {action: PreprocessAction.AwaitBlock; root: RootHex}
  | {action: PreprocessAction.AwaitEnvelope; root: RootHex};

/**
 * Network processor handles the gossip queues and throtles processing to not overload the main thread
 * - Decides when to process work and what to process
 *
 * What triggers execute work?
 *
 * - When work is submitted
 * - When downstream workers become available
 *
 * ### PendingGossipsubMessage beacon_attestation example
 *
 * For gossip messages, processing the message includes the steps:
 * 1. Pre shuffling sync validation
 * 2. Retrieve shuffling: async + goes into the regen queue and can be expensive
 * 3. Pre sig validation sync validation
 * 4. Validate BLS signature: async + goes into workers through another manager
 *
 * The gossip queues should receive "backpressue" from the regen and BLS workers queues.
 * Such that enough work is processed to fill either one of the queue.
 */
export class NetworkProcessor {
  private readonly chain: IBeaconChain;
  private readonly events: NetworkEventBus;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly gossipValidatorFn: GossipValidatorFn;
  private readonly gossipValidatorBatchFn: GossipValidatorBatchFn;
  private readonly gossipQueues: ReturnType<typeof createGossipQueues>;
  private readonly gossipTopicConcurrency: {[K in GossipType]: number};
  private readonly extractBlockSlotRootFns = createExtractBlockSlotRootFns();
  // we may not receive the block for messages like Attestation and SignedAggregateAndProof messages, in that case PendingGossipsubMessage needs
  // to be stored in this Map and reprocessed once the block comes
  private readonly awaitingMessagesByBlockRoot: MapDef<RootHex, Set<PendingGossipsubMessage>>;
  private awaitingBlockMessageCount = 0;
  // we may not receive the payload for messages that require the FULL payload variant to be processed,
  // in that case PendingGossipsubMessage needs to be stored in this Map and reprocessed once the payload comes
  private readonly awaitingMessagesByPayloadBlockRoot: MapDef<RootHex, Set<PendingGossipsubMessage>>;
  private awaitingPayloadMessageCount = 0;
  private unknownBlocksBySlot = new MapDef<Slot, Set<RootHex>>(() => new Set());
  private unknownEnvelopesBySlot = new MapDef<Slot, Set<RootHex>>(() => new Set());

  constructor(
    modules: NetworkProcessorModules,
    private readonly opts: NetworkProcessorOpts
  ) {
    const {chain, events, logger, metrics} = modules;
    this.chain = chain;
    this.events = events;
    this.metrics = metrics;
    this.logger = logger;
    this.events = events;
    this.gossipQueues = createGossipQueues();
    this.gossipTopicConcurrency = mapValues(this.gossipQueues, () => 0);
    this.gossipValidatorFn = getGossipValidatorFn(modules.gossipHandlers ?? getGossipHandlers(modules, opts), modules);
    this.gossipValidatorBatchFn = getGossipValidatorBatchFn(
      modules.gossipHandlers ?? getGossipHandlers(modules, opts),
      modules
    );

    events.on(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage);
    this.chain.emitter.on(routes.events.EventType.block, this.onBlockProcessed);
    this.chain.emitter.on(routes.events.EventType.executionPayload, this.onPayloadEnvelopeProcessed);
    this.chain.clock.on(ClockEvent.slot, this.onClockSlot);

    this.awaitingMessagesByBlockRoot = new MapDef<RootHex, Set<PendingGossipsubMessage>>(() => new Set());
    this.awaitingMessagesByPayloadBlockRoot = new MapDef<RootHex, Set<PendingGossipsubMessage>>(() => new Set());

    // TODO: Implement queues and priorization for ReqResp incoming requests
    // Listens to NetworkEvent.reqRespIncomingRequest event

    if (metrics) {
      metrics.gossipValidationQueue.length.addCollect(() => {
        for (const topic of executeGossipWorkOrder) {
          metrics.gossipValidationQueue.length.set({topic}, this.gossipQueues[topic].length);
          metrics.gossipValidationQueue.keySize.set({topic}, this.gossipQueues[topic].keySize);
          metrics.gossipValidationQueue.concurrency.set({topic}, this.gossipTopicConcurrency[topic]);
        }
        metrics.awaitingBlockGossipMessages.countPerSlot.set(this.unknownBlockGossipsubMessagesCount);
        metrics.awaitingPayloadGossipMessages.countPerSlot.set(this.unknownPayloadGossipsubMessagesCount);
        // specific metric for beacon_attestation topic
        metrics.gossipValidationQueue.keyAge.reset();
        for (const ageMs of this.gossipQueues.beacon_attestation.getDataAgeMs()) {
          metrics.gossipValidationQueue.keyAge.observe(ageMs / 1000);
        }
      });
    }

    // TODO: Pull new work when available
    // this.bls.onAvailable(() => this.executeWork());
    // this.regen.onAvailable(() => this.executeWork());
  }

  async stop(): Promise<void> {
    this.events.off(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage);
    this.chain.emitter.off(routes.events.EventType.block, this.onBlockProcessed);
    this.chain.emitter.off(routes.events.EventType.executionPayload, this.onPayloadEnvelopeProcessed);
    this.chain.emitter.off(ClockEvent.slot, this.onClockSlot);
  }

  dropAllJobs(): void {
    for (const topic of executeGossipWorkOrder) {
      this.gossipQueues[topic].clear();
    }
  }

  dumpGossipQueue(topic: GossipType): PendingGossipsubMessage[] {
    const queue = this.gossipQueues[topic];
    if (queue === undefined) {
      throw Error(`Unknown gossipType ${topic}, known values: ${Object.keys(this.gossipQueues).join(", ")}`);
    }

    return queue.getAll();
  }

  /**
   * Search block via `ChainEvent.unknownBlockRoot` event
   * Slot is the message slot, which is not necessarily the same as the block's slot, but it can be used for a good prune strategy.
   * In the rare case, if 2 messages on 2 slots search for the same root (for example beacon_attestation) we may emit the same root twice but BlockInputSync should handle it well.
   */
  searchUnknownBlock({slot, root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (
      this.chain.seenBlock(root) ||
      this.awaitingMessagesByBlockRoot.has(root) ||
      this.unknownBlocksBySlot.getOrDefault(slot).has(root)
    ) {
      return;
    }
    // Search for the unknown block
    this.unknownBlocksBySlot.getOrDefault(slot).add(root);
    this.chain.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: root, peer, source});
  }

  /**
   * Search envelope via `ChainEvent.unknownEnvelopeBlockRoot` event
   * Slot is the message slot, which is not necessarily the same as the envelope's slot, but it can be used for a good prune strategy.
   * In the rare case, if 2 messages on 2 slots search for the same root (for example beacon_attestation) we may emit the same root twice but BlockInputSync should handle it well.
   */
  searchUnknownEnvelope({slot, root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (
      this.chain.seenPayloadEnvelope(root) ||
      this.awaitingMessagesByPayloadBlockRoot.has(root) ||
      this.unknownEnvelopesBySlot.getOrDefault(slot).has(root)
    ) {
      return;
    }
    this.unknownEnvelopesBySlot.getOrDefault(slot).add(root);
    this.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex: root, peer, source});
  }

  private onPendingGossipsubMessage = (message: PendingGossipsubMessage): void => {
    const topicType = message.topic.type;
    const extractBlockSlotRootFn = this.extractBlockSlotRootFns[topicType];

    // 1st extract round: make sure slot is in range and if block root is not available
    // proactively search for it + queue the message
    const slotRoot = extractBlockSlotRootFn
      ? extractBlockSlotRootFn(message.msg.data, message.topic.boundary.fork)
      : null;
    if (slotRoot === null) {
      // some messages don't have slot and root
      // if the msg.data is invalid, message will be rejected when deserializing data in later phase (gossipValidatorFn)
      this.pushPendingGossipsubMessageToQueue(message);
      return;
    }

    // common check for all topics
    // DOS protection: avoid processing messages that are too old
    const {slot, root} = slotRoot;
    const clockSlot = this.chain.clock.currentSlot;
    const {fork} = message.topic.boundary;
    let earliestPermissableSlot = clockSlot - DEFAULT_EARLIEST_PERMISSIBLE_SLOT_DISTANCE;
    if (ForkSeq[fork] >= ForkSeq.deneb && topicType === GossipType.beacon_attestation) {
      // post deneb, the attestations could be in current or previous epoch
      earliestPermissableSlot = computeStartSlotAtEpoch(this.chain.clock.currentEpoch - 1);
    }
    if (slot < earliestPermissableSlot) {
      // No need to report the dropped job to gossip. It will be eventually pruned from the mcache
      this.metrics?.networkProcessor.gossipValidationError.inc({
        topic: topicType,
        error: GossipErrorCode.PAST_SLOT,
      });
      return;
    }

    message.msgSlot = slot;

    // this determines whether this message needs to wait for a Block or Envelope
    // a message should only wait for what it voted for, hence we don't want to put it on both queues
    let preprocessResult: PreprocessResult = {action: PreprocessAction.PushToQueue};
    // no need to check if root is a descendant of the current finalized block, it will be checked once we validate the message if needed
    if (root && !this.chain.forkChoice.hasBlockHexUnsafe(root)) {
      // starting from GLOAS, unknown root from data_column_sidecar also falls into this case
      this.searchUnknownBlock({slot, root}, BlockInputSource.network_processor, message.propagationSource.toString());
      // for beacon_attestation and beacon_aggregate_and_proof messages, this is only temporary.
      // if "index = 1" we need to await for the Envelope instead
      preprocessResult = {action: PreprocessAction.AwaitBlock, root};
    }

    // 2nd extract round for some specific topics
    // we separate the search action from the await action

    // beacon_block: proactively search for parent block/envelope across all forks, but never queue.
    // BlockInputSync handles cascading recovery if the gossip handler throws.
    if (topicType === GossipType.beacon_block) {
      const parentRoot = getParentRootFromSignedBeaconBlockSerialized(message.msg.data);
      if (parentRoot) {
        if (ForkSeq[fork] >= ForkSeq.gloas) {
          // GLOAS: also check parent envelope, same logic as execution_payload_bid
          const parentBlockHash = getParentBlockHashFromGloasSignedBeaconBlockSerialized(message.msg.data);
          if (parentBlockHash && !this.chain.forkChoice.getBlockHexAndBlockHash(parentRoot, parentBlockHash)) {
            const protoBlock = this.chain.forkChoice.getBlockHexDefaultStatus(parentRoot);
            if (protoBlock === null) {
              this.searchUnknownBlock(
                {slot, root: parentRoot},
                BlockInputSource.network_processor,
                message.propagationSource.toString()
              );
            } else if (
              protoBlock.executionPayloadBlockHash &&
              protoBlock.executionPayloadBlockHash !== parentBlockHash
            ) {
              // only search for the envelope by block root if we're sure there is one. Otherwise UnknownBlockSync will penalize the peer.
              this.searchUnknownEnvelope(
                {slot, root: parentRoot},
                BlockInputSource.network_processor,
                message.propagationSource.toString()
              );
            }
          }
        } else if (!this.chain.forkChoice.hasBlockHexUnsafe(parentRoot)) {
          this.searchUnknownBlock(
            {slot, root: parentRoot},
            BlockInputSource.network_processor,
            message.propagationSource.toString()
          );
        }
      }
      preprocessResult = {action: PreprocessAction.PushToQueue};
    }

    if (ForkSeq[fork] >= ForkSeq.gloas) {
      // specific check for each topic
      // note that it's supposed to NOT queue beacon_block (handled above) and execution_payload because it's not a one-off;
      // for those topics, gossip handlers will throw and BlockInputSync will handle a tree of them instead
      switch (topicType) {
        case GossipType.beacon_attestation:
        case GossipType.beacon_aggregate_and_proof: {
          if (root == null) break;
          const attIndex =
            topicType === GossipType.beacon_attestation
              ? getDataIndexFromSingleAttestationSerialized(fork, message.msg.data)
              : getDataIndexFromSignedAggregateAndProofSerialized(message.msg.data);
          if (attIndex === 1 && !this.chain.forkChoice.hasPayloadHexUnsafe(root)) {
            // attestation votes that the payload is available but it is not yet known
            this.searchUnknownEnvelope(
              {slot, root},
              BlockInputSource.network_processor,
              message.propagationSource.toString()
            );
            preprocessResult = {action: PreprocessAction.AwaitEnvelope, root};
          }
          break;
        }
        case GossipType.payload_attestation_message: {
          if (root == null) break;
          const payloadPresent = getPayloadPresentFromPayloadAttestationMessageSerialized(message.msg.data);
          if (payloadPresent && !this.chain.forkChoice.hasPayloadHexUnsafe(root)) {
            // payload attestation votes that the payload is available but it is not yet known
            this.searchUnknownEnvelope(
              {slot, root},
              BlockInputSource.network_processor,
              message.propagationSource.toString()
            );
            // do not await the envelope, payload attestation processing only requires that the block is known
            // also do not reset preprocessResult, we may already await for the block
          }
          break;
        }
        case GossipType.data_column_sidecar: {
          if (root == null) break;
          if (!this.chain.forkChoice.hasPayloadHexUnsafe(root)) {
            this.searchUnknownEnvelope(
              {slot, root},
              BlockInputSource.network_processor,
              message.propagationSource.toString()
            );
            // do not await the envelope, we can do gossip validation
            // also do not reset preprocessResult, we may already await for the block
          }
          break;
        }
        case GossipType.execution_payload: {
          // extractBlockSlotRootFn does not return a root for this topic.
          // Extract beacon_block_root directly and proactively trigger block sync if missing.
          // Do NOT await the block — the handler runs immediately; BlockInputSync handles recovery.
          const blockRoot = getBeaconBlockRootFromExecutionPayloadEnvelopeSerialized(message.msg.data);
          if (blockRoot && !this.chain.forkChoice.hasBlockHexUnsafe(blockRoot)) {
            this.searchUnknownBlock(
              {slot, root: blockRoot},
              BlockInputSource.network_processor,
              message.propagationSource.toString()
            );
          }
          // do not await the block, we want UnknownBlockSync to handle it.
          preprocessResult = {action: PreprocessAction.PushToQueue};
          break;
        }
        case GossipType.execution_payload_bid: {
          // instead of searching for the message root, this searches for the parent root
          const parentBlockRoot = getParentBlockRootFromSignedExecutionPayloadBidSerialized(message.msg.data);
          const parentBlockHash = getParentBlockHashFromSignedExecutionPayloadBidSerialized(message.msg.data);
          if (
            parentBlockRoot &&
            parentBlockHash &&
            !this.chain.forkChoice.getBlockHexAndBlockHash(parentBlockRoot, parentBlockHash)
          ) {
            const protoBlock = this.chain.forkChoice.getBlockHexDefaultStatus(parentBlockRoot);
            if (protoBlock === null) {
              this.searchUnknownBlock(
                {slot, root: parentBlockRoot},
                BlockInputSource.network_processor,
                message.propagationSource.toString()
              );
              preprocessResult = {action: PreprocessAction.AwaitBlock, root: parentBlockRoot};
            } else if (
              protoBlock.executionPayloadBlockHash &&
              protoBlock.executionPayloadBlockHash !== parentBlockHash
            ) {
              this.searchUnknownEnvelope(
                {slot, root: parentBlockRoot},
                BlockInputSource.network_processor,
                message.propagationSource.toString()
              );
              preprocessResult = {action: PreprocessAction.AwaitEnvelope, root: parentBlockRoot};
            }
          }
          break;
        }
      }
    }

    switch (preprocessResult.action) {
      case PreprocessAction.PushToQueue:
        this.pushPendingGossipsubMessageToQueue(message);
        break;
      case PreprocessAction.AwaitBlock: {
        if (this.unknownBlockGossipsubMessagesCount > MAX_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS) {
          // No need to report the dropped job to gossip. It will be eventually pruned from the mcache
          this.metrics?.awaitingBlockGossipMessages.reject.inc({
            reason: ReprocessRejectReason.reached_limit,
            topic: topicType,
          });
          return;
        }

        this.metrics?.awaitingBlockGossipMessages.queue.inc({topic: topicType});
        const awaitingGossipsubMessages = this.awaitingMessagesByBlockRoot.getOrDefault(preprocessResult.root);
        awaitingGossipsubMessages.add(message);
        this.awaitingBlockMessageCount++;
        break;
      }
      case PreprocessAction.AwaitEnvelope: {
        if (this.unknownPayloadGossipsubMessagesCount > MAX_QUEUED_UNKNOWN_PAYLOAD_GOSSIP_OBJECTS) {
          this.metrics?.awaitingPayloadGossipMessages.reject.inc({
            reason: ReprocessRejectReason.reached_limit,
            topic: topicType,
          });
          return;
        }

        this.metrics?.awaitingPayloadGossipMessages.queue.inc({topic: topicType});
        const awaitingPayloadGossipsubMessages = this.awaitingMessagesByPayloadBlockRoot.getOrDefault(
          preprocessResult.root
        );
        awaitingPayloadGossipsubMessages.add(message);
        this.awaitingPayloadMessageCount++;
        break;
      }
    }
  };

  private pushPendingGossipsubMessageToQueue(message: PendingGossipsubMessage): void {
    const topicType = message.topic.type;
    const droppedCount = this.gossipQueues[topicType].add(message);
    if (droppedCount) {
      // No need to report the dropped job to gossip. It will be eventually pruned from the mcache
      this.metrics?.gossipValidationQueue.droppedJobs.inc({topic: message.topic.type}, droppedCount);
    }

    // Tentatively perform work
    this.executeWork();
  }

  private onBlockProcessed = async ({block: rootHex}: {block: string; executionOptimistic: boolean}): Promise<void> => {
    const waitingGossipsubMessages = this.awaitingMessagesByBlockRoot.get(rootHex);
    if (!waitingGossipsubMessages || waitingGossipsubMessages.size === 0) {
      return;
    }

    const nowSec = Date.now() / 1000;
    let count = 0;
    // TODO: we can group attestations to process in batches but since we have the SeenAttestationDatas
    // cache, it may not be necessary at this time
    for (const message of waitingGossipsubMessages) {
      const topicType = message.topic.type;
      this.metrics?.awaitingBlockGossipMessages.waitSecBeforeResolve.set(
        {topic: topicType},
        nowSec - message.seenTimestampSec
      );
      this.metrics?.awaitingBlockGossipMessages.resolve.inc({topic: topicType});
      this.pushPendingGossipsubMessageToQueue(message);
      count++;
      // don't want to block the event loop, worse case it'd wait for 16_084 / 1024 * 50ms = 800ms which is not a big deal
      if (count === MAX_AWAITING_GOSSIP_OBJECTS_PER_TICK) {
        count = 0;
        await sleep(AWAITING_GOSSIP_OBJECTS_YIELD_EVERY_MS);
      }
    }

    this.awaitingBlockMessageCount -= waitingGossipsubMessages.size;
    this.awaitingMessagesByBlockRoot.delete(rootHex);
  };

  private onPayloadEnvelopeProcessed = async ({blockRoot: rootHex}: {blockRoot: RootHex}): Promise<void> => {
    const waitingGossipsubMessages = this.awaitingMessagesByPayloadBlockRoot.get(rootHex);
    if (!waitingGossipsubMessages || waitingGossipsubMessages.size === 0) {
      return;
    }

    const nowSec = Date.now() / 1000;
    let count = 0;
    for (const message of waitingGossipsubMessages) {
      const topicType = message.topic.type;
      this.metrics?.awaitingPayloadGossipMessages.waitSecBeforeResolve.set(
        {topic: topicType},
        nowSec - message.seenTimestampSec
      );
      this.metrics?.awaitingPayloadGossipMessages.resolve.inc({topic: topicType});
      this.pushPendingGossipsubMessageToQueue(message);
      count++;
      if (count === MAX_AWAITING_GOSSIP_OBJECTS_PER_TICK) {
        count = 0;
        await sleep(AWAITING_GOSSIP_OBJECTS_YIELD_EVERY_MS);
      }
    }

    this.awaitingPayloadMessageCount -= waitingGossipsubMessages.size;
    this.awaitingMessagesByPayloadBlockRoot.delete(rootHex);
  };

  private onClockSlot = (clockSlot: Slot): void => {
    const nowSec = Date.now() / 1000;
    const minSlot = clockSlot - MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE;

    for (const [slot, roots] of this.unknownBlocksBySlot) {
      if (slot > minSlot) continue;
      for (const rootHex of roots) {
        const gossipMessages = this.awaitingMessagesByBlockRoot.get(rootHex);
        if (gossipMessages !== undefined) {
          for (const message of gossipMessages) {
            const topicType = message.topic.type;
            this.metrics?.awaitingBlockGossipMessages.reject.inc({
              topic: topicType,
              reason: ReprocessRejectReason.expired,
            });
            this.metrics?.awaitingBlockGossipMessages.waitSecBeforeReject.set(
              {topic: topicType, reason: ReprocessRejectReason.expired},
              nowSec - message.seenTimestampSec
            );
            // No need to report the dropped job to gossip. It will be eventually pruned from the mcache
          }
          this.awaitingBlockMessageCount -= gossipMessages.size;
          this.awaitingMessagesByBlockRoot.delete(rootHex);
        }
      }
      this.unknownBlocksBySlot.delete(slot);
    }

    for (const [slot, roots] of this.unknownEnvelopesBySlot) {
      if (slot > minSlot) continue;
      for (const rootHex of roots) {
        const gossipMessages = this.awaitingMessagesByPayloadBlockRoot.get(rootHex);
        if (gossipMessages !== undefined) {
          for (const message of gossipMessages) {
            const topicType = message.topic.type;
            this.metrics?.awaitingPayloadGossipMessages.reject.inc({
              topic: topicType,
              reason: ReprocessRejectReason.expired,
            });
            this.metrics?.awaitingPayloadGossipMessages.waitSecBeforeReject.set(
              {topic: topicType, reason: ReprocessRejectReason.expired},
              nowSec - message.seenTimestampSec
            );
            // No need to report the dropped job to gossip. It will be eventually pruned from the mcache
          }
          this.awaitingPayloadMessageCount -= gossipMessages.size;
          this.awaitingMessagesByPayloadBlockRoot.delete(rootHex);
        }
      }
      this.unknownEnvelopesBySlot.delete(slot);
    }
  };

  private executeWork(): void {
    // TODO: Maybe de-bounce by timing the last time executeWork was run

    this.metrics?.networkProcessor.executeWorkCalls.inc();
    let jobsSubmitted = 0;

    job_loop: while (jobsSubmitted < MAX_JOBS_SUBMITTED_PER_TICK) {
      // Check if chain can accept work before calling queue.next() since it consumes the items
      const reason = this.checkAcceptWork();

      for (const topic of executeGossipWorkOrder) {
        // beacon block is guaranteed to be processed immedately
        // reason !== null means cannot accept work
        if (reason !== null && !executeGossipWorkOrderObj[topic]?.bypassQueue) {
          this.metrics?.networkProcessor.canNotAcceptWork.inc({reason});
          break job_loop;
        }
        if (
          this.opts.maxGossipTopicConcurrency !== undefined &&
          this.gossipTopicConcurrency[topic] > this.opts.maxGossipTopicConcurrency
        ) {
          // Reached concurrency limit for topic, continue to next topic
          continue;
        }

        const item = this.gossipQueues[topic].next();
        const numMessages = Array.isArray(item) ? item.length : 1;
        if (item) {
          this.gossipTopicConcurrency[topic] += numMessages;
          this.processPendingGossipsubMessage(item)
            .finally(() => {
              this.gossipTopicConcurrency[topic] -= numMessages;
            })
            .catch((e) => this.logger.error("processGossipAttestations must not throw", {}, e));

          jobsSubmitted += numMessages;
          // Attempt to find more work, but check canAcceptWork() again and run executeGossipWorkOrder priorization
          continue job_loop;
        }
      }

      // No item of work available on all queues, break off job_loop
      break;
    }

    if (jobsSubmitted > 0) {
      this.metrics?.networkProcessor.jobsSubmitted.observe(jobsSubmitted);
    }
  }

  private async processPendingGossipsubMessage(
    messageOrArray: PendingGossipsubMessage | PendingGossipsubMessage[]
  ): Promise<void> {
    const nowSec = Date.now() / 1000;
    if (Array.isArray(messageOrArray)) {
      for (const msg of messageOrArray) {
        msg.startProcessUnixSec = nowSec;
        if (msg.queueAddedMs !== undefined) {
          this.metrics?.gossipValidationQueue.queueTime.observe(nowSec - msg.queueAddedMs / 1000);
        }
      }
    } else {
      // indexed queue is not used here
      messageOrArray.startProcessUnixSec = nowSec;
    }

    const acceptanceArr = Array.isArray(messageOrArray)
      ? // for beacon_attestation topic, process attestations with same attestation data
        // we always have msgSlot in beaccon_attestation topic so the type conversion is safe
        await this.gossipValidatorBatchFn(messageOrArray as GossipMessageInfo[])
      : [
          // for other topics
          await this.gossipValidatorFn({...messageOrArray, msgSlot: messageOrArray.msgSlot ?? null}),
        ];

    if (Array.isArray(messageOrArray)) {
      for (const msg of messageOrArray) {
        this.trackJobTime(msg, messageOrArray.length);
      }
    } else {
      this.trackJobTime(messageOrArray, 1);
    }

    // Use setTimeout to yield to the macro queue
    // This is mostly due to too many attestation messages, and a gossipsub RPC may
    // contain multiple of them. This helps avoid the I/O lag issue.

    if (Array.isArray(messageOrArray)) {
      for (const [i, msg] of messageOrArray.entries()) {
        callInNextEventLoop(() => {
          this.events.emit(NetworkEvent.gossipMessageValidationResult, {
            msgId: msg.msgId,
            propagationSource: msg.propagationSource,
            acceptance: acceptanceArr[i],
          });
        });
      }
    } else {
      callInNextEventLoop(() => {
        this.events.emit(NetworkEvent.gossipMessageValidationResult, {
          msgId: messageOrArray.msgId,
          propagationSource: messageOrArray.propagationSource,
          acceptance: acceptanceArr[0],
        });
      });
    }
  }

  private trackJobTime(message: PendingGossipsubMessage, numJob: number): void {
    if (message.startProcessUnixSec !== null) {
      this.metrics?.gossipValidationQueue.jobWaitTime.observe(
        {topic: message.topic.type},
        message.startProcessUnixSec - message.seenTimestampSec
      );
      // if it takes 64ms to process 64 jobs, the average job time is 1ms
      this.metrics?.gossipValidationQueue.jobTime.observe(
        {topic: message.topic.type},
        (Date.now() / 1000 - message.startProcessUnixSec) / numJob
      );
    }
  }

  /**
   * Return null if chain can accept work, otherwise return the reason why it cannot accept work
   */
  private checkAcceptWork(): null | CannotAcceptWorkReason {
    if (!this.chain.blsThreadPoolCanAcceptWork()) {
      return CannotAcceptWorkReason.bls;
    }

    if (!this.chain.regenCanAcceptWork()) {
      return CannotAcceptWorkReason.regen;
    }

    return null;
  }

  private get unknownBlockGossipsubMessagesCount(): number {
    return this.awaitingBlockMessageCount;
  }

  private get unknownPayloadGossipsubMessagesCount(): number {
    return this.awaitingPayloadMessageCount;
  }
}
