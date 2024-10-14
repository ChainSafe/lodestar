import {LinkedList} from "../../../util/array.js";
import {LinearGossipQueueOpts, DropType, GossipQueue, QueueType} from "./types.js";

// Having a drop ratio of 1 will empty the queue which is too severe
// Worse case drop 95% of the queue
const MAX_DROP_RATIO = 0.95;

/**
 * Default gossip queue for all topics except for beacon_attestation
 * Support LIFO and FIFO type.
 */
export class LinearGossipQueue<T> implements GossipQueue<T> {
  private readonly list = new LinkedList<T>();
  // Increase _dropRatio gradually, retest its initial value if node is in good status
  private _dropRatio = 0;
  // this is to avoid the case we drop 90% of the queue, then queue is empty and we consider
  // node is in good status
  private recentDrop = false;
  // set recentDrop to false after we process up to maxLength items
  private processedCountSinceDrop = 0;

  constructor(private readonly opts: LinearGossipQueueOpts) {
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

  get keySize(): number {
    // this implementation doesn't support indexing
    return 1;
  }

  // not implemented for this gossip queue
  getDataAgeMs(): number[] {
    return [];
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
    }

    this.recentDrop = true;
    const droppedCount = this.dropByRatio(this._dropRatio);
    // increase drop ratio the next time queue is full
    this._dropRatio = Math.min(MAX_DROP_RATIO, this._dropRatio + this.opts.dropOpts.step);
    return droppedCount;
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
