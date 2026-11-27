import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TimeoutError} from "@lodestar/utils";
import {STREAM_DRAIN_TIMEOUT_MS, STREAM_WRITE_BUFFER_HIGH_WATER_MARK, sendChunks} from "../../../src/utils/stream.js";
import {SlowReaderStream} from "../../utils/mockStream.js";

describe("utils / stream / sendChunks", () => {
  let pulled: number;
  let outcome: unknown;

  function* chunks(size: number, count: number): Generator<Uint8Array> {
    for (let i = 0; i < count; i++) {
      pulled++;
      yield new Uint8Array(size);
    }
  }

  function startSend(stream: SlowReaderStream, source: Iterable<Uint8Array>): void {
    outcome = "pending";
    sendChunks(stream, source).then(
      () => {
        outcome = "resolved";
      },
      (e: unknown) => {
        outcome = e;
      }
    );
  }

  beforeEach(() => {
    pulled = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches writes up to the high-water mark instead of waiting per chunk, then completes on drain", async () => {
    const stream = new SlowReaderStream();
    const chunkSize = 1024;
    const count = 300;
    const batched = STREAM_WRITE_BUFFER_HIGH_WATER_MARK / chunkSize;
    startSend(stream, chunks(chunkSize, count));
    await vi.advanceTimersByTimeAsync(0);

    // buffered up to the high-water mark across many small chunks and parked once, not once per chunk
    expect(pulled).toBe(batched);
    expect(stream.writeBufferLength).toBe(STREAM_WRITE_BUFFER_HIGH_WATER_MARK);
    expect(outcome).toBe("pending");

    // the peer reads everything, so sendChunks flushes the buffer and sends the rest
    stream.drain();
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toBe("resolved");
    expect(pulled).toBe(count);
    expect(stream.writtenBytes).toBe(chunkSize * count);
  });

  it("bounds the write buffer to the high-water mark while the peer reads slowly", async () => {
    const stream = new SlowReaderStream();
    const chunkSize = STREAM_WRITE_BUFFER_HIGH_WATER_MARK / 4;
    const count = 20;
    startSend(stream, chunks(chunkSize, count));

    let maxBuffered = 0;
    for (let i = 0; i < count && outcome === "pending"; i++) {
      await vi.advanceTimersByTimeAsync(0);
      maxBuffered = Math.max(maxBuffered, stream.writeBufferLength);
      // peer reads one high-water mark worth per tick
      stream.drain(STREAM_WRITE_BUFFER_HIGH_WATER_MARK);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toBe("resolved");
    expect(pulled).toBe(count);
    expect(stream.writtenBytes).toBe(chunkSize * count);
    // never held more than the high-water mark plus the one chunk that crosses it
    expect(maxBuffered).toBeLessThanOrEqual(STREAM_WRITE_BUFFER_HIGH_WATER_MARK + chunkSize);
  });

  it("aborts once the peer stops reading for STREAM_DRAIN_TIMEOUT_MS", async () => {
    const stream = new SlowReaderStream();
    startSend(stream, chunks(STREAM_WRITE_BUFFER_HIGH_WATER_MARK, 10));

    // one drain restarts the deadline, then the peer stalls
    await vi.advanceTimersByTimeAsync(STREAM_DRAIN_TIMEOUT_MS / 2);
    stream.drain(STREAM_WRITE_BUFFER_HIGH_WATER_MARK);
    await vi.advanceTimersByTimeAsync(STREAM_DRAIN_TIMEOUT_MS - 1);
    expect(outcome).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBeInstanceOf(TimeoutError);
  });

  it("rejects as soon as the stream closes while waiting for a drain", async () => {
    const stream = new SlowReaderStream();
    startSend(stream, chunks(STREAM_WRITE_BUFFER_HIGH_WATER_MARK, 10));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe("pending");

    const error = new Error("stream reset");
    stream.abort(error);
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toBe(error);
  });
});
