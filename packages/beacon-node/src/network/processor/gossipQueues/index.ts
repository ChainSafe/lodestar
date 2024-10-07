import {mapValues} from "@lodestar/utils";
import {BatchGossipType, GossipType, SequentialGossipType} from "../../gossip/interface.js";
import {PendingGossipsubMessage} from "../types.js";
import {getGossipAttestationIndex} from "../../../util/sszBytes.js";
import {LinearGossipQueue} from "./linear.js";
import {DropType, GossipQueue, GossipQueueOpts, QueueType, isIndexedGossipQueueMinSizeOpts} from "./types.js";
import {IndexedGossipQueueMinSize} from "./indexed.js";

/**
 * In normal condition, the higher this value the more efficient the signature verification.
 * However, if at least 1 signature is invalid, we need to verify each signature separately.
 */
const MAX_GOSSIP_ATTESTATION_BATCH_SIZE = 128;

/**
 * Minimum signature sets to batch verify without waiting for 50ms.
 */
export const MIN_SIGNATURE_SETS_TO_BATCH_VERIFY = 32;

/**
 * Numbers from https://github.com/sigp/lighthouse/blob/b34a79dc0b02e04441ba01fd0f304d1e203d877d/beacon_node/network/src/beacon_processor/mod.rs#L69
 */
const linearGossipQueueOpts: {
  [K in SequentialGossipType]: GossipQueueOpts<PendingGossipsubMessage>;
} = {
  // validation gossip block asap
  [GossipType.beacon_block]: {maxLength: 1024, type: QueueType.FIFO, dropOpts: {type: DropType.count, count: 1}},
  // gossip length for blob is beacon block length * max blobs per block = 4096
  [GossipType.blob_sidecar]: {
    maxLength: 4096,
    type: QueueType.FIFO,
    dropOpts: {type: DropType.count, count: 1},
  },
  // lighthoue has aggregate_queue 4096 and unknown_block_aggregate_queue 1024, we use single queue
  [GossipType.beacon_aggregate_and_proof]: {
    maxLength: 5120,
    type: QueueType.LIFO,
    dropOpts: {type: DropType.count, count: 1},
  },
  [GossipType.voluntary_exit]: {maxLength: 4096, type: QueueType.FIFO, dropOpts: {type: DropType.count, count: 1}},
  [GossipType.proposer_slashing]: {maxLength: 4096, type: QueueType.FIFO, dropOpts: {type: DropType.count, count: 1}},
  [GossipType.attester_slashing]: {maxLength: 4096, type: QueueType.FIFO, dropOpts: {type: DropType.count, count: 1}},
  [GossipType.sync_committee_contribution_and_proof]: {
    maxLength: 4096,
    type: QueueType.LIFO,
    dropOpts: {type: DropType.count, count: 1},
  },
  [GossipType.sync_committee]: {maxLength: 4096, type: QueueType.LIFO, dropOpts: {type: DropType.count, count: 1}},
  [GossipType.light_client_finality_update]: {
    maxLength: 1024,
    type: QueueType.FIFO,
    dropOpts: {type: DropType.count, count: 1},
  },
  [GossipType.light_client_optimistic_update]: {
    maxLength: 1024,
    type: QueueType.FIFO,
    dropOpts: {type: DropType.count, count: 1},
  },
  // lighthouse has bls changes queue set to their max 16384 to handle large spike at capella
  [GossipType.bls_to_execution_change]: {
    maxLength: 16384,
    type: QueueType.FIFO,
    dropOpts: {type: DropType.count, count: 1},
  },
};

const indexedGossipQueueOpts: {
  [K in BatchGossipType]: GossipQueueOpts<PendingGossipsubMessage>;
} = {
  [GossipType.beacon_attestation]: {
    // lighthouse has attestation_queue 16384 and unknown_block_attestation_queue 8192, we use single queue
    // this topic may cause node to be overload and drop 100% of lower priority queues
    maxLength: 24576,
    indexFn: (item: PendingGossipsubMessage) => {
      // Note indexFn is fork agnostic despite changes introduced in Electra
      return getGossipAttestationIndex(item.msg.data);
    },
    minChunkSize: MIN_SIGNATURE_SETS_TO_BATCH_VERIFY,
    maxChunkSize: MAX_GOSSIP_ATTESTATION_BATCH_SIZE,
  },
};

/**
 * Wraps a GossipValidatorFn with a queue, to limit the processing of gossip objects by type.
 *
 * A queue here is essential to protect against DOS attacks, where a peer may send many messages at once.
 * Queues also protect the node against overloading. If the node gets bussy with an expensive epoch transition,
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
export function createGossipQueues(): {
  [K in GossipType]: GossipQueue<PendingGossipsubMessage>;
} {
  const gossipQueueOpts = {...linearGossipQueueOpts, ...indexedGossipQueueOpts};

  return mapValues(gossipQueueOpts, (opts) => {
    if (isIndexedGossipQueueMinSizeOpts(opts)) {
      return new IndexedGossipQueueMinSize(opts);
    } else {
      return new LinearGossipQueue<PendingGossipsubMessage>(opts);
    }
  });
}
