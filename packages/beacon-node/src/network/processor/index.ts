import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {Logger, MapDef, mapValues} from "@lodestar/utils";
import {RootHex, Slot} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEvent, NetworkEventBus, ReprocessGossipMessageType} from "../events.js";
import {GossipType, UnknownBlockFromGossipObjectFn} from "../gossip/interface.js";
import {ChainEvent} from "../../chain/emitter.js";
import {createGossipQueues} from "./gossipQueues.js";
import {NetworkWorker, NetworkWorkerModules} from "./worker.js";
import {PendingGossipsubMessage, WaitingGossipsubMessage} from "./types.js";
import {ValidatorFnsModules, GossipHandlerOpts} from "./gossipHandlers.js";
import {createUnknownBlockFromGossipObjectFns} from "./unknownBlockFromGossipObject.js";

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

type WorkOpts = {
  bypassQueue?: boolean;
};

/**
 * True if we want to process gossip object immediately, false if we check for bls and regen
 * in order to process the gossip object.
 */
const executeGossipWorkOrderObj: Record<GossipType, WorkOpts> = {
  // gossip block verify signatures on main thread, hence we want to bypass the bls check
  [GossipType.beacon_block]: {bypassQueue: true},
  [GossipType.beacon_block_and_blobs_sidecar]: {bypassQueue: true},
  [GossipType.beacon_aggregate_and_proof]: {},
  [GossipType.beacon_attestation]: {},
  [GossipType.voluntary_exit]: {},
  [GossipType.proposer_slashing]: {},
  [GossipType.attester_slashing]: {},
  [GossipType.sync_committee_contribution_and_proof]: {},
  [GossipType.sync_committee]: {},
  [GossipType.light_client_finality_update]: {},
  [GossipType.light_client_optimistic_update]: {},
  [GossipType.bls_to_execution_change]: {},
};
const executeGossipWorkOrder = Object.keys(executeGossipWorkOrderObj) as (keyof typeof executeGossipWorkOrderObj)[];

// TODO: Arbitrary constant, check metrics
const MAX_JOBS_SUBMITTED_PER_TICK = 128;

// How many attestations (aggregate + unaggregate) we keep before new ones get dropped.
const MAXIMUM_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS = 16_384;

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
 *
 * ### WaitingGossipsubMessage beacon_attestation example
 * 1. beacon_attestation gossip message passes through gossipQueues and executeWork()
 * 2. During gossip validation, it throws UNKNOWN_BLOCK error
 * 3. A WaitingGossipsubMessage instance is created which is the same to PendingGossipsubMessage with addedTimeMs
 * 4. WaitingGossipsubMessage is then put to a temporary queue implemented as slot/root hex map (deleted per slot)
 * 5. Once the block comes with same slot/root WaitingGossipsubMessage is then pushed back to gossipQueues again
 */
export class NetworkProcessor {
  private readonly worker: NetworkWorker;
  private readonly chain: IBeaconChain;
  private readonly events: NetworkEventBus;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly gossipQueues = createGossipQueues<PendingGossipsubMessage>();
  private readonly gossipTopicConcurrency = mapValues(this.gossipQueues, () => 0);
  private readonly unknownBlockFns = createUnknownBlockFromGossipObjectFns();
  // validating GossipMessage may result in UNKNOWN_BLOCK error, in that case PendingGossipsubMessage needs
  // to be stored in this Map and reprocessed once the block comes
  private readonly awaitingGossipsubMessagesByRootBySlot: MapDef<Slot, MapDef<RootHex, Set<WaitingGossipsubMessage>>>;
  private unknownBlockGossipsubMessagesCount = 0;

  constructor(modules: NetworkProcessorModules, private readonly opts: NetworkProcessorOpts) {
    const {chain, events, logger, metrics} = modules;
    this.chain = chain;
    this.events = events;
    this.metrics = metrics;
    this.logger = logger;
    this.worker = new NetworkWorker(modules, opts);

    events.on(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage.bind(this));
    events.on(NetworkEvent.reprocessGossipsubMessage, this.onReprocessGossipsubMessage.bind(this));
    this.chain.emitter.on(routes.events.EventType.block, this.onBlockProcessed.bind(this));
    this.chain.emitter.on(ChainEvent.clockSlot, this.onClockSlot.bind(this));

    this.awaitingGossipsubMessagesByRootBySlot = new MapDef(
      () => new MapDef<RootHex, Set<WaitingGossipsubMessage>>(() => new Set())
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
    this.events.off(NetworkEvent.reprocessGossipsubMessage, this.onReprocessGossipsubMessage);
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

  private onPendingGossipsubMessage(data: PendingGossipsubMessage): void {
    const droppedJob = this.gossipQueues[data.topic.type].add(data);
    if (droppedJob) {
      // TODO: Should report the dropped job to gossip? It will be eventually pruned from the mcache
      this.metrics?.gossipValidationQueueDroppedJobs.inc({topic: data.topic.type});
    }

    // Tentatively perform work
    this.executeWork();
  }

  private onReprocessGossipsubMessage(data: PendingGossipsubMessage, reprocessType: ReprocessGossipMessageType): void {
    if (!data.gossipObject) {
      throw Error("Should have gossip object after the 1st gossip validation");
    }
    if (reprocessType === ReprocessGossipMessageType.unknownBlock) {
      if (this.unknownBlockGossipsubMessagesCount > MAXIMUM_QUEUED_UNKNOWN_BLOCK_GOSSIP_OBJECTS) {
        this.metrics?.reprocessGossipAttestations.reject.inc({reason: ReprocessRejectReason.reached_limit});
        return;
      }

      this.metrics?.reprocessGossipAttestations.total.inc();
      const {slot, root} = (this.unknownBlockFns[data.topic.type] as UnknownBlockFromGossipObjectFn)(data.gossipObject);
      const awaitingGossipsubMessagesByRoot = this.awaitingGossipsubMessagesByRootBySlot.getOrDefault(slot);
      const awaitingGossipsubMessages = awaitingGossipsubMessagesByRoot.getOrDefault(root);
      (data as WaitingGossipsubMessage).addedTimeMs = Date.now();
      awaitingGossipsubMessages.add(data as WaitingGossipsubMessage);
      this.unknownBlockGossipsubMessagesCount++;
    }
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
      this.metrics?.reprocessGossipAttestations.waitSecBeforeResolve.set((now - msg.addedTimeMs) / 1000);
      this.onPendingGossipsubMessage(msg);
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
            this.metrics?.reprocessGossipAttestations.waitSecBeforeReject.set((now - message.addedTimeMs) / 1000);
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

    this.metrics?.networkProcessor.jobsSubmitted.observe(jobsSubmitted);
  }
}
