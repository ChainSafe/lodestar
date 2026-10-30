const MAX_CACHED_STATE_BYTES = 64 * 1024 * 1024;

/** Reuses the most recently requested finalized state without retaining a state tree. */
export class HistoricalStateResponseCache {
  private latest?: {slot: number; bytes: Promise<Uint8Array>};

  constructor(
    private readonly load: (slot: number) => Promise<Uint8Array>,
    private readonly signal: AbortSignal,
    private readonly maxBytes = MAX_CACHED_STATE_BYTES
  ) {
    signal.addEventListener(
      "abort",
      () => {
        this.latest = undefined;
      },
      {once: true}
    );
  }

  async get(slot: number): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    let entry = this.latest;
    if (entry?.slot !== slot) {
      entry = {
        slot,
        bytes: Promise.resolve().then(async () => {
          this.signal.throwIfAborted();
          return Uint8Array.from(await this.load(slot));
        }),
      };
      this.latest = entry;
    }
    try {
      const bytes = await entry.bytes;
      this.signal.throwIfAborted();
      if (bytes.byteLength > this.maxBytes && this.latest === entry) this.latest = undefined;
      // Each caller owns its buffer, including when the response is transferred to another worker.
      return Uint8Array.from(bytes);
    } catch (error) {
      if (this.latest === entry) this.latest = undefined;
      throw error;
    }
  }
}
