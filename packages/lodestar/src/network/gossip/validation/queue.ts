import {AbortSignal} from "@chainsafe/abort-controller";
import {IMetrics} from "../../../metrics";
import {JobQueue, JobQueueOpts, QueueType} from "../../../util/queue";
import {GossipType, TopicValidatorFn} from "../interface";

// Numbers from https://github.com/sigp/lighthouse/blob/b34a79dc0b02e04441ba01fd0f304d1e203d877d/beacon_node/network/src/beacon_processor/mod.rs#L69
const gossipQueueOpts: {[K in GossipType]: Pick<JobQueueOpts, "maxLength" | "type" | "maxConcurrency">} = {
  [GossipType.beacon_block]: {maxLength: 1024, type: QueueType.FIFO},
  // this is different from lighthouse's, there are more gossip aggregate_and_proof than gossip block
  [GossipType.beacon_aggregate_and_proof]: {maxLength: 4096, type: QueueType.LIFO, maxConcurrency: 16},
  [GossipType.beacon_attestation]: {maxLength: 16384, type: QueueType.LIFO, maxConcurrency: 64},
  [GossipType.voluntary_exit]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.proposer_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.attester_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.sync_committee_contribution_and_proof]: {maxLength: 4096, type: QueueType.LIFO},
  [GossipType.sync_committee]: {maxLength: 4096, type: QueueType.LIFO},
};

/**
 * Wraps an ObjectValidatorFn as a TopicValidatorFn
 * See TopicValidatorFn here https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L529
 */
export function wrapWithQueue(
  gossipMessageHandler: TopicValidatorFn,
  type: GossipType,
  signal: AbortSignal,
  metrics: IMetrics | null
): TopicValidatorFn {
  const jobQueue = new JobQueue(
    {signal, ...gossipQueueOpts[type]},
    metrics
      ? {
          length: metrics.gossipValidationQueueLength.child({topic: type}),
          droppedJobs: metrics.gossipValidationQueueDroppedJobs.child({topic: type}),
          jobTime: metrics.gossipValidationQueueJobTime.child({topic: type}),
          jobWaitTime: metrics.gossipValidationQueueJobWaitTime.child({topic: type}),
        }
      : undefined
  );

  return async function (topicStr, gossipMsg) {
    await jobQueue.push(async () => gossipMessageHandler(topicStr, gossipMsg));
  };
}
