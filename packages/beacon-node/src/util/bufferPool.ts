import {Metrics} from "../metrics/metrics.js";

/**
 * If consumer wants more memory than available, we grow the buffer by this ratio.
 */
const GROW_RATIO = 1.1;

/**
 * A simple implementation to manage a single buffer.
 * This is initially used for state serialization at every epoch and for state reload.
 * We can enhance and use this for other purposes in the future.
 */
export class BufferPool {
  private buffer: Uint8Array;
  private inUse = false;
  private currentKey: number;
  private readonly metrics: Metrics["bufferPool"] | null = null;

  constructor(size: number, metrics: Metrics | null = null) {
    this.buffer = new Uint8Array(Math.floor(size * GROW_RATIO));
    this.currentKey = 0;
    if (metrics) {
      this.metrics = metrics.bufferPool;
      metrics.bufferPool.length.addCollect(() => {
        metrics.bufferPool.length.set(this.buffer.length);
      });
    }
  }

  get length(): number {
    return this.buffer.length;
  }

  /**
   * Returns a buffer of the given size with all 0.
   * If the buffer is already in use, return null.
   * Grow the buffer if the requested size is larger than the current buffer.
   */
  alloc(size: number): BufferWithKey | null {
    return this.doAlloc(size, false);
  }

  /**
   * Same to alloc() but the buffer is not zeroed.
   */
  allocUnsafe(size: number): BufferWithKey | null {
    return this.doAlloc(size, true);
  }

  private doAlloc(size: number, isUnsafe = false): BufferWithKey | null {
    if (this.inUse) {
      this.metrics?.misses.inc();
      return null;
    }
    this.inUse = true;
    this.metrics?.hits.inc();
    this.currentKey += 1;
    if (size > this.buffer.length) {
      this.metrics?.grows.inc();
      this.buffer = new Uint8Array(Math.floor(size * GROW_RATIO));
    }
    const bytes = this.buffer.subarray(0, size);
    if (!isUnsafe) {
      bytes.fill(0);
    }
    return new BufferWithKey(bytes, this.currentKey, this);
  }

  /**
   * Marks the buffer as free.
   */
  free(key: number): void {
    if (key === this.currentKey) {
      this.inUse = false;
    }
  }
}

export class BufferWithKey implements Disposable {
  constructor(
    readonly buffer: Uint8Array,
    private readonly key: number,
    private readonly pool: BufferPool
  ) {}

  [Symbol.dispose](): void {
    this.pool.free(this.key);
  }
}
