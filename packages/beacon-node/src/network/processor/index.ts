import {Logger, MapDef, mapValues, sleep} from "@lodestar/utils";
import {RootHex, Slot} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {GossipType} from "../gossip/interface.js";
import {ClockEvent} from "../../util/clock.js";
import {GossipErrorCode} from "../../chain/errors/gossipValidation.js";
import {createGossipQueues} from "./gossipQueues.js";
import {NetworkWorker, NetworkWorkerModules} from "./worker.js";
import {PendingGossipsubMessage} from "./types.js";
import {ValidatorFnsModules, GossipHandlerOpts} from "./gossipHandlers.js";
import {createExtractBlockSlotRootFns} from "./extractSlotRootFns.js";

export type NetworkProcessorModules = NetworkWorkerModules &
  ValidatorFnsModules & {
    chain: IBeaconChain;
    events: NetworkEventBus;
    logger: Logger;
    metrics: Metrics | null;
  };

export type NetworkProcessorOpts = GossipHandlerOpts & {
  maxGossipTopicConcurrency?: number;
};

/**
 * This is respective to gossipsub seenTTL (which is 550 * 0.7 = 385s), also it's respective
 * to beacon_attestation ATTESTATION_PROPAGATION_SLOT_RANGE (32 slots).
 * If message slots are withint this window, it'll likely to be filtered by gossipsub seenCache.
 * This is mainly for DOS protection, see https://github.com/ChainSafe/lodestar/issues/5393
 */
const EARLIEST_PERMISSABLE_SLOT_DISTANCE = 32;

type WorkOpts = {
  bypassQueue?: boolean;
};

/**
 * True if we want to process gossip object immediately, false if we check for bls and regen
 * in order to process the gossip object.
 */
const executeGossipWorkOrderObj: Record<GossipType, WorkOpts> = {
  [GossipType.beacon_block]: {bypassQueue: true},
  [GossipType.beacon_block_and_blobs_sidecar]: {bypassQueue: true},
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
};
const executeGossipWorkOrder = Object.keys(executeGossipWorkOrderObj) as (keyof typeof executeGossipWorkOrderObj)[];

// TODO: Arbitrary constant, check metrics
const MAX_JOBS_SUBMITTED_PER_TICK = 128;

// How many attestations (aggregate + unaggregate) we keep before new ones get dropped.
const MAX_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS = 16_384;

// We don't want to process too many attestations in a single tick
// As seen on mainnet, attestation concurrency metric ranges from 1000 to 2000
// so make this constant a little bit conservative
const MAX_UNKNOWN_BLOCK_GOSSIP_OBJECTS_PER_TICK = 1024;

// Same motivation to JobItemQueue, we don't want to block the event loop
const PROCESS_UNKNOWN_BLOCK_GOSSIP_OBJECTS_YIELD_EVERY_MS = 50;

/**
 * Reprocess reject reason for metrics
 */
enum ReprocessRejectReason {
  /**
   * There are too many attestations that have unknown block root.
   */
  reached_limit = "reached_limit",
  /**
   * The awaiting attestation is pruned per clock slot.
   */
  expired = "expired",
}

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
 * For attestations, processing the message includes the steps:
 * 1. Pre shuffling sync validation
 * 2. Retrieve shuffling: async + goes into the regen queue and can be expensive
 * 3. Pre sig validation sync validation
 * 4. Validate BLS signature: async + goes into workers through another manager
 *
 * The gossip queues should receive "backpressue" from the regen and BLS workers queues.
 * Such that enough work is processed to fill either one of the queue.
 */
export class NetworkProcessor {
  private readonly worker: NetworkWorker;
  private readonly chain: IBeaconChain;
  private readonly events: NetworkEventBus;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly gossipQueues = createGossipQueues<PendingGossipsubMessage>();
  private readonly gossipTopicConcurrency = mapValues(this.gossipQueues, () => 0);
  private readonly extractBlockSlotRootFns = createExtractBlockSlotRootFns();
  // we may not receive the block for Attestation and SignedAggregateAndProof messages, in that case PendingGossipsubMessage needs
  // to be stored in this Map and reprocessed once the block comes
  private readonly awaitingGossipsubMessagesByRootBySlot: MapDef<Slot, MapDef<RootHex, Set<PendingGossipsubMessage>>>;
  private unknownBlockGossipsubMessagesCount = 0;

  constructor(modules: NetworkProcessorModules, private readonly opts: NetworkProcessorOpts) {
    const {chain, events, logger, metrics} = modules;
    this.chain = chain;
    this.events = events;
    this.metrics = metrics;
    this.logger = logger;
    this.worker = new NetworkWorker(modules, opts);

    events.on(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage.bind(this));
    this.chain.emitter.on(routes.events.EventType.block, this.onBlockProcessed.bind(this));
    this.chain.clock.on(ClockEvent.slot, this.onClockSlot.bind(this));

    this.awaitingGossipsubMessagesByRootBySlot = new MapDef(
      () => new MapDef<RootHex, Set<PendingGossipsubMessage>>(() => new Set())
    );

    if (metrics) {
      metrics.gossipValidationQueue.length.addCollect(() => {
        for (const topic of executeGossipWorkOrder) {
          metrics.gossipValidationQueue.length.set({topic}, this.gossipQueues[topic].length);
          metrics.gossipValidationQueue.dropRatio.set({topic}, this.gossipQueues[topic].dropRatio);
          metrics.gossipValidationQueue.concurrency.set({topic}, this.gossipTopicConcurrency[topic]);
        }
        metrics.reprocessGossipAttestations.countPerSlot.set(this.unknownBlockGossipsubMessagesCount);
      });
    }

    // TODO: Pull new work when available
    // this.bls.onAvailable(() => this.executeWork());
    // this.regen.onAvailable(() => this.executeWork());
  }

  async stop(): Promise<void> {
    this.events.off(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage);
    this.chain.emitter.off(routes.events.EventType.block, this.onBlockProcessed);
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

  private onPendingGossipsubMessage(message: PendingGossipsubMessage): void {
    const extractBlockSlotRootFn = this.extractBlockSlotRootFns[message.topic.type];
    // check block root of Attestation and SignedAggregateAndProof messages
    if (extractBlockSlotRootFn) {
      const slotRoot = extractBlockSlotRootFn(message.msg.data);
      // if slotRoot is null, it means the msg.data is invalid
      // in that case message will be rejected when deserializing data in later phase (gossipValidatorFn)
      if (slotRoot) {
        // DOS protection: avoid processing messages that are too old
        const {slot, root} = slotRoot;
        if (slot < this.chain.clock.currentSlot - EARLIEST_PERMISSABLE_SLOT_DISTANCE) {
          // TODO: Should report the dropped job to gossip? It will be eventually pruned from the mcache
          this.metrics?.networkProcessor.gossipValidationError.inc({
            topic: message.topic.type,
            error: GossipErrorCode.PAST_SLOT,
          });
          return;
        }
        message.msgSlot = slot;
        if (root && !this.chain.forkChoice.hasBlockHex(root)) {
          if (this.unknownBlockGossipsubMessagesCount > MAX_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS) {
            // TODO: Should report the dropped job to gossip? It will be eventually pruned from the mcache
            this.metrics?.reprocessGossipAttestations.reject.inc({reason: ReprocessRejectReason.reached_limit});
            return;
          }

          this.metrics?.reprocessGossipAttestations.total.inc();
          const awaitingGossipsubMessagesByRoot = this.awaitingGossipsubMessagesByRootBySlot.getOrDefault(slot);
          const awaitingGossipsubMessages = awaitingGossipsubMessagesByRoot.getOrDefault(root);
          awaitingGossipsubMessages.add(message);
          this.unknownBlockGossipsubMessagesCount++;
          return;
        }
      }
    }

    // bypass the check for other messages
    this.pushPendingGossipsubMessageToQueue(message);
  }

  private pushPendingGossipsubMessageToQueue(message: PendingGossipsubMessage): void {
    const topicType = message.topic.type;
    const droppedCount = this.gossipQueues[topicType].add(message);
    if (droppedCount) {
      // TODO: Should report the dropped job to gossip? It will be eventually pruned from the mcache
      this.metrics?.gossipValidationQueue.droppedJobs.inc({topic: message.topic.type}, droppedCount);
    }

    // Tentatively perform work
    this.executeWork();
  }

  private async onBlockProcessed({
    slot,
    block: rootHex,
  }: {
    slot: Slot;
    block: string;
    executionOptimistic: boolean;
  }): Promise<void> {
    const byRootGossipsubMessages = this.awaitingGossipsubMessagesByRootBySlot.getOrDefault(slot);
    const waitingGossipsubMessages = byRootGossipsubMessages.getOrDefault(rootHex);
    if (waitingGossipsubMessages.size === 0) {
      return;
    }

    this.metrics?.reprocessGossipAttestations.resolve.inc(waitingGossipsubMessages.size);
    const nowSec = Date.now() / 1000;
    let count = 0;
    // TODO: we can group attestations to process in batches but since we have the SeenAttestationDatas
    // cache, it may not be necessary at this time
    for (const message of waitingGossipsubMessages) {
      this.metrics?.reprocessGossipAttestations.waitSecBeforeResolve.set(nowSec - message.seenTimestampSec);
      this.pushPendingGossipsubMessageToQueue(message);
      count++;
      // don't want to block the event loop, worse case it'd wait for 16_084 / 1024 * 50ms = 800ms which is not a big deal
      if (count === MAX_UNKNOWN_BLOCK_GOSSIP_OBJECTS_PER_TICK) {
        count = 0;
        await sleep(PROCESS_UNKNOWN_BLOCK_GOSSIP_OBJECTS_YIELD_EVERY_MS);
      }
    }

    byRootGossipsubMessages.delete(rootHex);
  }

  private onClockSlot(clockSlot: Slot): void {
    const nowSec = Date.now() / 1000;
    for (const [slot, gossipMessagesByRoot] of this.awaitingGossipsubMessagesByRootBySlot.entries()) {
      if (slot < clockSlot) {
        for (const gossipMessages of gossipMessagesByRoot.values()) {
          for (const message of gossipMessages) {
            this.metrics?.reprocessGossipAttestations.reject.inc({reason: ReprocessRejectReason.expired});
            this.metrics?.reprocessGossipAttestations.waitSecBeforeReject.set(nowSec - message.seenTimestampSec);
            // TODO: Should report the dropped job to gossip? It will be eventually pruned from the mcache
          }
        }
        this.awaitingGossipsubMessagesByRootBySlot.delete(slot);
      }
    }
    this.unknownBlockGossipsubMessagesCount = 0;
  }

  private executeWork(): void {
    // TODO: Maybe de-bounce by timing the last time executeWork was run

    this.metrics?.networkProcessor.executeWorkCalls.inc();
    let jobsSubmitted = 0;

    job_loop: while (jobsSubmitted < MAX_JOBS_SUBMITTED_PER_TICK) {
      // Check canAcceptWork before calling queue.next() since it consumes the items
      const canAcceptWork = this.chain.blsThreadPoolCanAcceptWork() && this.chain.regenCanAcceptWork();

      for (const topic of executeGossipWorkOrder) {
        // beacon block is guaranteed to be processed immedately
        if (!canAcceptWork && !executeGossipWorkOrderObj[topic]?.bypassQueue) {
          this.metrics?.networkProcessor.canNotAcceptWork.inc();
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
        if (item) {
          this.gossipTopicConcurrency[topic]++;
          this.worker
            .processPendingGossipsubMessage(item)
            .finally(() => this.gossipTopicConcurrency[topic]--)
            .catch((e) => this.logger.error("processGossipAttestations must not throw", {}, e));

          jobsSubmitted++;
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
}
