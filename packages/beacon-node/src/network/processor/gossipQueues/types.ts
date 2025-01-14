export type GossipQueueOpts<T> = LinearGossipQueueOpts | IndexedGossipQueueMinSizeOpts<T>;

export type LinearGossipQueueOpts = {
  type: QueueType;
  maxLength: number;
  dropOpts: DropOpts;
};

export type IndexedGossipQueueOpts<T> = {
  maxLength: number;
  indexFn: (item: T) => string | null;
};

export type IndexedGossipQueueMinSizeOpts<T> = IndexedGossipQueueOpts<T> & {
  minChunkSize: number;
  maxChunkSize: number;
};

export function isIndexedGossipQueueMinSizeOpts<T>(opts: GossipQueueOpts<T>): opts is IndexedGossipQueueMinSizeOpts<T> {
  const minSizeOpts = opts as IndexedGossipQueueMinSizeOpts<T>;
  return (
    minSizeOpts.indexFn !== undefined &&
    minSizeOpts.minChunkSize !== undefined &&
    minSizeOpts.maxChunkSize !== undefined
  );
}

export interface GossipQueue<T> {
  length: number;
  keySize: number;
  getDataAgeMs(): number[];
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
