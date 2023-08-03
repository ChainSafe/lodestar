import {mapValues} from "@lodestar/utils";
import {LinkedList} from "../../util/array.js";
import {GossipType} from "../gossip/interface.js";

export enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

export enum DropType {
  count = "count",
  ratio = "ratio",
}

type DropOpts =
  | {
      type: DropType.count;
      count: number;
    }
  | {
      type: DropType.ratio;
      start: number;
      step: number;
    };

// Having a drop ratio of 1 will empty the queue which is too severe
// Worse case drop 95% of the queue
const MAX_DROP_RATIO = 0.95;

/**
 * Numbers from https://github.com/sigp/lighthouse/blob/b34a79dc0b02e04441ba01fd0f304d1e203d877d/beacon_node/network/src/beacon_processor/mod.rs#L69
 */
const gossipQueueOpts: {
  [K in GossipType]: GossipQueueOpts;
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
  // lighthouse has attestation_queue 16384 and unknown_block_attestation_queue 8192, we use single queue
  // this topic may cause node to be overload and drop 100% of lower priority queues
  // so we want to drop it by ratio until node is stable enough (queue is empty)
  // start with dropping 1% of the queue, then increase 1% more each time. Reset when queue is empty
  [GossipType.beacon_attestation]: {
    maxLength: 24576,
    type: QueueType.LIFO,
    dropOpts: {type: DropType.ratio, start: 0.01, step: 0.01},
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

type GossipQueueOpts = {
  type: QueueType;
  maxLength: number;
  dropOpts: DropOpts;
};

export class GossipQueue<T> {
  private readonly list = new LinkedList<T>();
  // Increase _dropRatio gradually, retest its initial value if node is in good status
  private _dropRatio = 0;
  // this is to avoid the case we drop 90% of the queue, then queue is empty and we consider
  // node is in good status
  private recentDrop = false;
  // set recentDrop to false after we process up to maxLength items
  private processedCountSinceDrop = 0;

  constructor(private readonly opts: GossipQueueOpts) {
    if (opts.dropOpts.type === DropType.ratio) {
      const {start, step} = opts.dropOpts;
      if (start <= 0 || start > 1) {
        throw Error(`Invalid drop ratio start ${start} step ${step}`);
      }
      this._dropRatio = opts.dropOpts.start;
    }
  }

  get length(): number {
    return this.list.length;
  }

  get dropRatio(): number {
    return this._dropRatio;
  }

  clear(): void {
    this.list.clear();
  }

  /**
   * Add item to gossip queue.
   * Return number of items dropped
   */
  add(item: T): number {
    // this signals the node is not overloaded anymore
    if (this.opts.dropOpts.type === DropType.ratio && !this.recentDrop && this.length === 0) {
      // reset drop ratio to see if node is comfortable with it
      this._dropRatio = this.opts.dropOpts.start;
    }

    this.list.push(item);

    if (this.list.length <= this.opts.maxLength) {
      return 0;
    }

    // overload, need to drop more items
    if (this.opts.dropOpts.type === DropType.count) {
      return this.dropByCount(this.opts.dropOpts.count);
    } else {
      this.recentDrop = true;
      const droppedCount = this.dropByRatio(this._dropRatio);
      // increase drop ratio the next time queue is full
      this._dropRatio = Math.min(MAX_DROP_RATIO, this._dropRatio + this.opts.dropOpts.step);
      return droppedCount;
    }
  }

  next(): T | null {
    let item: T | null = null;
    // LIFO -> pop() remove last item, FIFO -> shift() remove first item
    switch (this.opts.type) {
      case QueueType.LIFO:
        item = this.list.pop();
        break;
      case QueueType.FIFO:
        item = this.list.shift();
        break;
    }

    // it's ok to mark recent drop as false if we dropped <50% of the queue the last time
    if (this.opts.dropOpts.type === DropType.ratio && this.recentDrop && item !== null) {
      this.processedCountSinceDrop++;
      if (this.processedCountSinceDrop >= this.opts.maxLength) {
        this.recentDrop = false;
        this.processedCountSinceDrop = 0;
      }
    }

    return item;
  }

  getAll(): T[] {
    return this.list.toArray();
  }

  /**
   * Drop up to some ratio of items from the queue
   * ratio is from 0 to 1 inclusive
   * Return number of items dropped
   */
  private dropByRatio(ratio: number): number {
    if (ratio < 0 || ratio > 1) {
      throw Error(`Invalid ratio ${ratio}`);
    }

    if (ratio === 0) {
      return 0;
    }

    if (ratio === 1) {
      const numDeleted = this.length;
      this.clear();
      return numDeleted;
    }

    const count = Math.floor(this.list.length * ratio);
    return this.dropByCount(count);
  }

  /**
   * Drop up to some number of items from the queue
   * Return number of items dropped
   */
  private dropByCount(count: number): number {
    if (count <= 0) {
      return 0;
    }

    if (count >= this.length) {
      const numDeleted = this.length;
      this.clear();
      return numDeleted;
    }

    let i = 0;
    while (i < count && this.length > 0) {
      if (this.opts.type === QueueType.LIFO) {
        this.list.shift();
      } else {
        this.list.pop();
      }
      i++;
    }

    return i;
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
