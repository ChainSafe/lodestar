export type GossipQueueOpts<T> = LinearGossipQueueOpts | IndexedGossipQueueOpts<T>;

export type LinearGossipQueueOpts = {
  type: QueueType;
  maxLength: number;
  dropOpts: DropOpts;
};

export type IndexedGossipQueueOpts<T> = {
  maxLength: number;
  indexFn: (item: T) => string | null;
  minChunkSize: number;
  maxChunkSize: number;
};

export function isIndexedGossipQueueOpts<T>(opts: GossipQueueOpts<T>): opts is IndexedGossipQueueOpts<T> {
  return (opts as IndexedGossipQueueOpts<T>).indexFn !== undefined;
}

export interface GossipQueue<T> {
  length: number;
  keySize: number;
  clear: () => void;
  next: () => T | T[] | null;
  add: (item: T) => number;
  getAll(): T[];
}

export enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

export enum DropType {
  count = "count",
  ratio = "ratio",
}

export type DropOpts =
  | {
      type: DropType.count;
      count: number;
    }
  | {
      type: DropType.ratio;
      start: number;
      step: number;
    };
