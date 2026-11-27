import type {Stream, StreamCloseEvent} from "@libp2p/interface";
import {ByteStream, StreamClosedError} from "@libp2p/utils";
import {Uint8ArrayList} from "uint8arraylist";
import {ErrorAborted, withTimeout} from "@lodestar/utils";

/** Max time a write waits for the stream to drain, so a peer that stops reading cannot hold the stream open */
export const STREAM_DRAIN_TIMEOUT_MS = 10_000;

// Wait for the stream to drain only once this many bytes are buffered, so small chunks coalesce. QUIC
// signals backpressure (send returns false, writableNeedsDrain) after every write even when it accepted
// the bytes and nothing is buffered; gating on buffered bytes avoids a drain round trip per chunk there
// while still bounding the buffer for a peer that reads slowly over a muxer with a per-stream write queue.
export const STREAM_WRITE_BUFFER_HIGH_WATER_MARK = 256 * 1024;

export async function sendChunks(
  stream: Stream,
  source: Iterable<Uint8Array | Uint8ArrayList> | AsyncIterable<Uint8Array | Uint8ArrayList>,
  signal?: AbortSignal
): Promise<void> {
  for await (const chunk of source) {
    if (signal?.aborted) {
      throw new ErrorAborted("sendChunks");
    }

    stream.send(chunk);

    while (stream.writeBufferLength >= STREAM_WRITE_BUFFER_HIGH_WATER_MARK) {
      await withTimeout(
        (timeoutAndParentSignal) => waitForDrain(stream, timeoutAndParentSignal),
        STREAM_DRAIN_TIMEOUT_MS,
        signal
      );
    }
  }
}

// Not `stream.onDrain()`: libp2p never resets its drain promise once resolved, so every later call resolves
// immediately and the rest of the response is buffered in memory regardless of how slowly the peer reads
function waitForDrain(stream: Stream, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      stream.removeEventListener("drain", onDrain);
      stream.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (evt: StreamCloseEvent): void => {
      cleanup();
      reject(evt.error ?? new StreamClosedError());
    };
    const onAbort = (): void => {
      cleanup();
      reject(new ErrorAborted("sendChunks"));
    };

    stream.addEventListener("drain", onDrain);
    stream.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort);
  });
}

export function drainByteStream(bytes: ByteStream<Stream>): Uint8Array | undefined {
  const readBuffer = (
    bytes as unknown as {
      readBuffer?: {byteLength: number; subarray: () => Uint8Array; consume: (bytes: number) => void};
    }
  ).readBuffer;
  if (readBuffer && readBuffer.byteLength > 0) {
    const drained = readBuffer.subarray();
    readBuffer.consume(readBuffer.byteLength);
    return drained;
  }
  return undefined;
}
