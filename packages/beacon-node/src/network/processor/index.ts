import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {Logger, MapDef, mapValues} from "@lodestar/utils";
import {RootHex, Slot} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {GossipType} from "../gossip/interface.js";
import {ChainEvent} from "../../chain/emitter.js";
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

const executeGossipWorkOrderObj: Record<GossipType, true> = {
  [GossipType.beacon_block]: true,
  [GossipType.beacon_block_and_blobs_sidecar]: true,
  [GossipType.beacon_aggregate_and_proof]: true,
  [GossipType.beacon_attestation]: true,
  [GossipType.voluntary_exit]: true,
  [GossipType.proposer_slashing]: true,
  [GossipType.attester_slashing]: true,
  [GossipType.sync_committee_contribution_and_proof]: true,
  [GossipType.sync_committee]: true,
  [GossipType.light_client_finality_update]: true,
  [GossipType.light_client_optimistic_update]: true,
  [GossipType.bls_to_execution_change]: true,
};
const executeGossipWorkOrder = Object.keys(executeGossipWorkOrderObj) as (keyof typeof executeGossipWorkOrderObj)[];

// TODO: Arbitrary constant, check metrics
const MAX_JOBS_SUBMITTED_PER_TICK = 128;

// How many attestations (aggregate + unaggregate) we keep before new ones get dropped.
const MAX_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS = 16_384;

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
    this.chain.emitter.on(ChainEvent.clockSlot, this.onClockSlot.bind(this));

    this.awaitingGossipsubMessagesByRootBySlot = new MapDef(
      () => new MapDef<RootHex, Set<PendingGossipsubMessage>>(() => new Set())
    );

    if (metrics) {
      metrics.gossipValidationQueueLength.addCollect(() => {
        for (const topic of executeGossipWorkOrder) {
          metrics.gossipValidationQueueLength.set({topic}, this.gossipQueues[topic].length);
          metrics.gossipValidationQueueConcurrency.set({topic}, this.gossipTopicConcurrency[topic]);
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
    this.chain.emitter.off(ChainEvent.clockSlot, this.onClockSlot);
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
      const {slot, root: rootHex} = extractBlockSlotRootFn(message.msg.data);
      if (!this.chain.forkChoice.hasBlockHex(rootHex)) {
        if (this.unknownBlockGossipsubMessagesCount > MAX_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS) {
          this.metrics?.reprocessGossipAttestations.reject.inc({reason: ReprocessRejectReason.reached_limit});
          return;
        }

        const awaitingGossipsubMessagesByRoot = this.awaitingGossipsubMessagesByRootBySlot.getOrDefault(slot);
        const awaitingGossipsubMessages = awaitingGossipsubMessagesByRoot.getOrDefault(rootHex);
        awaitingGossipsubMessages.add(message);
        this.unknownBlockGossipsubMessagesCount++;
      }
    }

    // bypass the check for other messages
    this.pushPendingGossipsubMessageToQueue(message);
  }

  private pushPendingGossipsubMessageToQueue(message: PendingGossipsubMessage): void {
    const topicType = message.topic.type;
    const droppedJob = this.gossipQueues[topicType].add(message);
    if (droppedJob) {
      // TODO: Should report the dropped job to gossip? It will be eventually pruned from the mcache
      this.metrics?.gossipValidationQueueDroppedJobs.inc({topic: message.topic.type});
    }

    // Tentatively perform work
    this.executeWork();
  }

  private onBlockProcessed({slot, block: rootHex}: {slot: Slot; block: string; executionOptimistic: boolean}): void {
    const byRootGossipsubMessages = this.awaitingGossipsubMessagesByRootBySlot.getOrDefault(slot);
    const waitingGossipsubMessages = byRootGossipsubMessages.getOrDefault(rootHex);
    if (waitingGossipsubMessages.size === 0) {
      return;
    }

    this.metrics?.reprocessGossipAttestations.resolve.inc(waitingGossipsubMessages.size);
    const now = Date.now();
    waitingGossipsubMessages.forEach((msg) => {
      this.metrics?.reprocessGossipAttestations.waitSecBeforeResolve.set((now - msg.seenTimestampSec) / 1000);
      // TODO: in the worse case, there could be up to 16_000 attestations waiting gossipsub messages
      // don't push to the queue at once
      this.pushPendingGossipsubMessageToQueue(msg);
    });

    byRootGossipsubMessages.delete(rootHex);
  }

  private onClockSlot(clockSlot: Slot): void {
    const now = Date.now();
    for (const [slot, gossipMessagesByRoot] of this.awaitingGossipsubMessagesByRootBySlot.entries()) {
      if (slot < clockSlot) {
        for (const gossipMessages of gossipMessagesByRoot.values()) {
          gossipMessages.forEach((message) => {
            this.metrics?.reprocessGossipAttestations.reject.inc({reason: ReprocessRejectReason.expired});
            this.metrics?.reprocessGossipAttestations.waitSecBeforeReject.set((now - message.seenTimestampSec) / 1000);
            this.events.emit(
              NetworkEvent.gossipMessageValidationResult,
              message.msgId,
              message.propagationSource,
              TopicValidatorResult.Ignore
            );
          });
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
      if (!this.chain.blsThreadPoolCanAcceptWork() || !this.chain.regenCanAcceptWork()) {
        this.metrics?.networkProcessor.canNotAcceptWork.inc();
        break;
      }

      for (const topic of executeGossipWorkOrder) {
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

    this.metrics?.networkProcessor.jobsSubmitted.observe(jobsSubmitted);
  }
}
