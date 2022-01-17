import {AbortSignal} from "@chainsafe/abort-controller";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../../metrics";
import {JobItemQueue, JobQueueOpts, QueueType} from "../../../util/queue";
import {GossipJobQueues, GossipTopic, GossipType, ProcessRpcMessageFn} from "../interface";

/**
 * Numbers from https://github.com/sigp/lighthouse/blob/b34a79dc0b02e04441ba01fd0f304d1e203d877d/beacon_node/network/src/beacon_processor/mod.rs#L69
 */
const gossipQueueOpts: {[K in GossipType]: Pick<JobQueueOpts, "maxLength" | "type" | "maxConcurrency">} = {
  [GossipType.beacon_block]: {maxLength: 1024, type: QueueType.FIFO},
  // lighthoue has aggregate_queue 4096 and unknown_block_aggregate_queue 1024, we use single queue
  [GossipType.beacon_aggregate_and_proof]: {maxLength: 5120, type: QueueType.LIFO, maxConcurrency: 16},
  // lighthouse has attestation_queue 16384 and unknown_block_attestation_queue 8192, we use single queue
  [GossipType.beacon_attestation]: {maxLength: 24576, type: QueueType.LIFO, maxConcurrency: 64},
  [GossipType.voluntary_exit]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.proposer_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.attester_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.sync_committee_contribution_and_proof]: {maxLength: 4096, type: QueueType.LIFO, maxConcurrency: 16},
  [GossipType.sync_committee]: {maxLength: 4096, type: QueueType.LIFO, maxConcurrency: 64},
};

/**
 * Wraps a _processRpcMessage() function with a queue, to limit the processing of gossip objects by type.
 *
 * A queue here is essential to protect against DOS attacks, where a peer may send many messages at once.
 * Queues also protect the node against overloading. If the node gets busy with an expensive epoch transition,
 * it may buffer too many gossip objects causing an Out of memory (OOM) error. With a queue the node will reject
 * new objects to fit its current throughput.
 *
 * Queues may buffer objects by
 *  - topic '/eth2/0011aabb/beacon_attestation_0/ssz_snappy'
 *  - type `GossipType.beacon_attestation`
 *  - all objects in one queue
 *
 * By topic is too specific, so by type groups all similar objects in the same queue. All in the same won't allow
 * to customize different queue behaviours per object type (see `gossipQueueOpts`).
 */
export function createProcessRpcMessageQueues(
  processRpcMsgFn: ProcessRpcMessageFn,
  signal: AbortSignal,
  metrics: IMetrics | null
): GossipJobQueues {
  return mapValues(gossipQueueOpts, (opts, type) => {
    return new JobItemQueue<[GossipTopic, InMessage], void>(
      (topic, message) => processRpcMsgFn(message),
      {signal, ...opts},
      metrics
        ? {
            length: metrics.gossipValidationQueueLength.child({topic: type}),
            droppedJobs: metrics.gossipValidationQueueDroppedJobs.child({topic: type}),
            jobTime: metrics.gossipValidationQueueJobTime.child({topic: type}),
            jobWaitTime: metrics.gossipValidationQueueJobWaitTime.child({topic: type}),
          }
        : undefined
    );
  });
}
