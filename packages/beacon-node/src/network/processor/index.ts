import {Logger, mapValues} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {GossipType} from "../gossip/interface.js";
import {createGossipQueues} from "./gossipQueues.js";
import {NetworkWorker, NetworkWorkerModules} from "./worker.js";
import {PendingGossipsubMessage} from "./types.js";
import {ValidatorFnsModules, GossipHandlerOpts} from "./gossipHandlers.js";

export type NetworkProcessorModules = NetworkWorkerModules &
  ValidatorFnsModules & {
    chain: IBeaconChain;
    events: NetworkEventBus;
    logger: Logger;
    metrics: Metrics | null;
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
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly gossipQueues = createGossipQueues<PendingGossipsubMessage>();
  private readonly gossipTopicConcurrency = mapValues(this.gossipQueues, () => 0);

  constructor(modules: NetworkProcessorModules, opts: GossipHandlerOpts) {
    const {chain, events, logger, metrics} = modules;
    this.chain = chain;
    this.metrics = metrics;
    this.logger = logger;
    this.worker = new NetworkWorker(modules, opts);

    events.on(NetworkEvent.pendingGossipsubMessage, this.onPendingGossipsubMessage.bind(this));

    if (metrics) {
      metrics.gossipValidationQueueLength.addCollect(() => {
        for (const topic of executeGossipWorkOrder) {
          metrics.gossipValidationQueueLength.set({topic}, this.gossipQueues[topic].length);
        }
      });
    }

    // TODO: Pull new work when available
    // this.bls.onAvailable(() => this.executeWork());
    // this.regen.onAvailable(() => this.executeWork());
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

  private executeWork(): void {
    // TODO: Maybe de-bounce by timing the last time executeWork was run

    this.metrics?.networkProcessor.executeWorkCalls.inc();

    a: for (let i = 0; i < MAX_JOBS_SUBMITTED_PER_TICK; i++) {
      // TODO: Add metrics for when available or not
      if (!this.chain.blsThreadPoolCanAcceptWork() || !this.chain.regenCanAcceptWork()) {
        this.metrics?.networkProcessor.canNotAcceptWork.inc();
        return;
      }

      for (const topic of executeGossipWorkOrder) {
        const item = this.gossipQueues[topic].next();
        if (item) {
          this.gossipTopicConcurrency[topic]++;
          this.worker
            .processPendingGossipsubMessage(item)
            .finally(() => this.gossipTopicConcurrency[topic]--)
            .catch((e) => this.logger.error("processGossipAttestations must not throw", {}, e));

          this.metrics?.networkProcessor.jobsSubmitted.inc();

          // Attempt to find more work respecting executeGossipWorkOrder priorization
          continue a;
        }
      }
    }

    this.metrics?.networkProcessor.maxJobsSubmittedByTick.inc();
  }
}
