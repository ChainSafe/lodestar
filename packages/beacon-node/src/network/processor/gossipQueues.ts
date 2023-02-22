import {mapValues} from "@lodestar/utils";
import {LinkedList} from "../../util/array.js";
import {GossipType} from "../gossip/interface.js";

enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

/**
 * Numbers from https://github.com/sigp/lighthouse/blob/b34a79dc0b02e04441ba01fd0f304d1e203d877d/beacon_node/network/src/beacon_processor/mod.rs#L69
 */
const gossipQueueOpts: {
  [K in GossipType]: GossipQueueOpts;
} = {
  // validation gossip block asap
  [GossipType.beacon_block]: {maxLength: 1024, type: QueueType.FIFO},
  // TODO DENEB: What's a good queue max given that now blocks are much bigger?
  [GossipType.beacon_block_and_blobs_sidecar]: {maxLength: 32, type: QueueType.FIFO},
  // lighthoue has aggregate_queue 4096 and unknown_block_aggregate_queue 1024, we use single queue
  [GossipType.beacon_aggregate_and_proof]: {maxLength: 5120, type: QueueType.LIFO},
  // lighthouse has attestation_queue 16384 and unknown_block_attestation_queue 8192, we use single queue
  [GossipType.beacon_attestation]: {maxLength: 24576, type: QueueType.LIFO},
  [GossipType.voluntary_exit]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.proposer_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.attester_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.sync_committee_contribution_and_proof]: {maxLength: 4096, type: QueueType.LIFO},
  [GossipType.sync_committee]: {maxLength: 4096, type: QueueType.LIFO},
  [GossipType.light_client_finality_update]: {maxLength: 1024, type: QueueType.FIFO},
  [GossipType.light_client_optimistic_update]: {maxLength: 1024, type: QueueType.FIFO},
  // check ??  MAX_BLS_TO_EXECUTION_CHANGES	2**4 (= 16)
  [GossipType.bls_to_execution_change]: {maxLength: 1024, type: QueueType.FIFO},
};

type GossipQueueOpts = {
  type: QueueType;
  maxLength: number;
};

export class GossipQueue<T> {
  private readonly list = new LinkedList<T>();

  constructor(private readonly opts: GossipQueueOpts) {}

  get length(): number {
    return this.list.length;
  }

  clear(): void {
    this.list.clear();
  }

  add(item: T): T | null {
    let droppedItem: T | null = null;

    if (this.list.length + 1 > this.opts.maxLength) {
      // LIFO -> keep latest job, drop oldest, FIFO -> drop latest job
      switch (this.opts.type) {
        case QueueType.LIFO:
          droppedItem = this.list.shift();
          break;
        case QueueType.FIFO:
          return item;
      }
    }

    this.list.push(item);

    return droppedItem;
  }

  next(): T | null {
    // LIFO -> pop() remove last item, FIFO -> shift() remove first item
    switch (this.opts.type) {
      case QueueType.LIFO:
        return this.list.pop();
      case QueueType.FIFO:
        return this.list.shift();
    }
  }
}

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
export function createGossipQueues<T>(): {[K in GossipType]: GossipQueue<T>} {
  return mapValues(gossipQueueOpts, (opts) => {
    return new GossipQueue<T>(opts);
  });
}
