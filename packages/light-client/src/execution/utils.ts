import {RootHex} from "@lodestar/types";
import {bytesToBigInt, bigIntToBytes, sleep} from "@lodestar/utils";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {defaultQueueOpts, JobQueueOpts, QueueError, QueueErrorCode, QueueType} from "./queue/index.js";

/* eslint-disable @typescript-eslint/naming-convention */

/** QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API */
export type QUANTITY = string;
/** DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API */
export type DATA = string;

export const rootHexRegex = /^0x[a-fA-F0-9]{64}$/;

export function numberToHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 *
 * When encoding QUANTITIES (integers, numbers): encode as hex, prefix with “0x”, the most compact representation (slight exception: zero should be represented as “0x0”). Examples:
 * - 0x41 (65 in decimal)
 * - 0x400 (1024 in decimal)
 * - WRONG: 0x (should always have at least one digit - zero is “0x0”)
 * - WRONG: 0x0400 (no leading zeroes allowed)
 * - WRONG: ff (must be prefixed 0x)
 */
export function numToQuantity(num: number | bigint): QUANTITY {
  return "0x" + num.toString(16);
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function quantityToNum(hex: QUANTITY, id = ""): number {
  const num = parseInt(hex, 16);
  if (isNaN(num) || num < 0) throw Error(`Invalid hex decimal ${id} '${hex}'`);
  return num;
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 * Typesafe fn to convert hex string to bigint. The BigInt constructor param is any
 */
export function quantityToBigint(hex: QUANTITY, id = ""): bigint {
  try {
    return BigInt(hex);
  } catch (e) {
    throw Error(`Invalid hex bigint ${id} '${hex}': ${(e as Error).message}`);
  }
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 */
export function quantityToBytes(hex: QUANTITY): Uint8Array {
  const bn = quantityToBigint(hex);
  return bigIntToBytes(bn, 32, "le");
}

/**
 * QUANTITY as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API.
 * Compress a 32 ByteVector into a QUANTITY
 */
export function bytesToQuantity(bytes: Uint8Array): QUANTITY {
  const bn = bytesToBigInt(bytes as Uint8Array, "le");
  return numToQuantity(bn);
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 *
 * When encoding UNFORMATTED DATA (byte arrays, account addresses, hashes, bytecode arrays): encode as hex, prefix with
 * “0x”, two hex digits per byte. Examples:
 *
 * - 0x41 (size 1, “A”)
 * - 0x004200 (size 3, “\0B\0”)
 * - 0x (size 0, “”)
 * - WRONG: 0xf0f0f (must be even number of digits)
 * - WRONG: 004200 (must be prefixed 0x)
 */
export function bytesToData(bytes: Uint8Array): DATA {
  return toHexString(bytes);
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function dataToBytes(hex: DATA, fixedLength?: number): Uint8Array {
  try {
    const bytes = fromHexString(hex);
    if (fixedLength !== undefined && bytes.length !== fixedLength) {
      throw Error(`Wrong data length ${bytes.length} expected ${fixedLength}`);
    }
    return bytes;
  } catch (e) {
    (e as Error).message = `Invalid hex string: ${(e as Error).message}`;
    throw e;
  }
}

/**
 * DATA as defined in ethereum execution layer JSON RPC https://eth.wiki/json-rpc/API
 */
export function dataToRootHex(hex: DATA, id = ""): RootHex {
  if (!rootHexRegex.test(hex)) throw Error(`Invalid hex root ${id} '${hex}'`);
  return hex;
}

/**
 * JobQueue that stores arguments in the job array instead of closures.
 * Supports a single itemProcessor, for arbitrary functions use the JobFnQueue
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class JobItemQueue<Args extends any[], R> {
  private readonly opts: Required<JobQueueOpts>;
  /**
   * We choose to use LinkedList instead of regular array to improve shift() / push() / pop() performance.
   * See the LinkedList benchmark for more details.
   * */
  private readonly jobs: LinkedList<{
    args: Args;
    addedTimeMs: number;
    resolve: (result: R | PromiseLike<R>) => void;
    reject: (error?: Error) => void;
  }> = new LinkedList();
  private runningJobs = 0;
  private lastYield = 0;

  constructor(private readonly itemProcessor: (...args: Args) => Promise<R>, opts: JobQueueOpts) {
    this.opts = {...defaultQueueOpts, ...opts};
    this.opts.signal.addEventListener("abort", this.abortAllJobs, {once: true});
  }

  push(...args: Args): Promise<R> {
    if (this.opts.signal.aborted) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }

    if (this.jobs.length + 1 > this.opts.maxLength) {
      if (this.opts.type === QueueType.LIFO) {
        // In LIFO queues keep the latest job and drop the oldest
        this.jobs.shift();
      } else {
        // In FIFO queues drop the latest job
        throw new QueueError({code: QueueErrorCode.QUEUE_MAX_LENGTH});
      }
    }

    return new Promise<R>((resolve, reject) => {
      this.jobs.push({args, resolve, reject, addedTimeMs: Date.now()});
      if (this.runningJobs < this.opts.maxConcurrency) {
        setTimeout(this.runJob, 0);
      }
    });
  }

  getItems(): {args: Args; addedTimeMs: number}[] {
    return this.jobs.map((job) => ({args: job.args, addedTimeMs: job.addedTimeMs}));
  }

  dropAllJobs = (): void => {
    this.jobs.clear();
  };

  private runJob = async (): Promise<void> => {
    if (this.opts.signal.aborted || this.runningJobs >= this.opts.maxConcurrency) {
      return;
    }

    // Default to FIFO. LIFO -> pop() remove last item, FIFO -> shift() remove first item
    const job = this.opts.type === QueueType.LIFO ? this.jobs.pop() : this.jobs.shift();
    if (!job) {
      return;
    }

    this.runningJobs++;

    try {
      const result = await this.itemProcessor(...job.args);
      job.resolve(result);

      // Yield to the macro queue
      if (Date.now() - this.lastYield > this.opts.yieldEveryMs) {
        this.lastYield = Date.now();
        await sleep(0);
      }
    } catch (e) {
      job.reject(e as Error);
    }

    this.runningJobs = Math.max(0, this.runningJobs - 1);

    // Potentially run a new job
    void this.runJob();
  };

  private abortAllJobs = (): void => {
    while (this.jobs.length > 0) {
      const job = this.jobs.pop();
      if (job) job.reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    }
  };
}

/**
 * Return the last index in the array that matches the predicate
 */
export function findLastIndex<T>(array: T[], predicate: (value: T) => boolean): number {
  let i = array.length;
  while (i--) {
    if (predicate(array[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * The node for LinkedList below
 */
class Node<T> {
  data: T;
  next: Node<T> | null = null;
  prev: Node<T> | null = null;

  constructor(data: T) {
    this.data = data;
  }
}

/**
 * We want to use this if we only need push/pop/shift method
 * without random access.
 * The shift() method should be cheaper than regular array.
 */
export class LinkedList<T> {
  private _length: number;
  private head: Node<T> | null;
  private tail: Node<T> | null;

  constructor() {
    this._length = 0;
    this.head = null;
    this.tail = null;
  }

  get length(): number {
    return this._length;
  }

  push(data: T): void {
    if (this._length === 0) {
      this.tail = this.head = new Node(data);
      this._length++;
      return;
    }

    if (!this.head || !this.tail) {
      // should not happen
      throw Error("No head or tail");
    }

    const newTail = new Node(data);
    this.tail.next = newTail;
    newTail.prev = this.tail;
    this.tail = newTail;
    this._length++;
  }

  pop(): T | null {
    const oldTail = this.tail;
    if (!oldTail) return null;
    this._length = Math.max(0, this._length - 1);

    if (this._length === 0) {
      this.head = this.tail = null;
    } else {
      this.tail = oldTail.prev;
      if (this.tail) this.tail.next = null;
      oldTail.prev = oldTail.next = null;
    }

    return oldTail.data;
  }

  shift(): T | null {
    const oldHead = this.head;
    if (!oldHead) return null;
    this._length = Math.max(0, this._length - 1);

    if (this._length === 0) {
      this.head = this.tail = null;
    } else {
      this.head = oldHead.next;
      if (this.head) this.head.prev = null;
      oldHead.prev = oldHead.next = null;
    }

    return oldHead.data;
  }

  clear(): void {
    this.head = this.tail = null;
    this._length = 0;
  }

  toArray(): T[] {
    let node = this.head;
    if (!node) return [];

    const arr: T[] = [];
    while (node) {
      arr.push(node.data);
      node = node.next;
    }

    return arr;
  }

  map<U>(fn: (t: T) => U): U[] {
    let node = this.head;
    if (!node) return [];

    const arr: U[] = [];
    while (node) {
      arr.push(fn(node.data));
      node = node.next;
    }

    return arr;
  }
}
