import type {Stream} from "@libp2p/interface";
import {ByteStream} from "@libp2p/utils";
import {Uint8ArrayList} from "uint8arraylist";
import {ErrorAborted} from "@lodestar/utils";

export async function sendChunks(
  stream: Stream,
  source: Iterable<Uint8Array | Uint8ArrayList> | AsyncIterable<Uint8Array | Uint8ArrayList>,
  signal?: AbortSignal
): Promise<void> {
  for await (const chunk of source) {
    if (signal?.aborted) {
      throw new ErrorAborted("sendChunks");
    }

    if (!stream.send(chunk)) {
      await stream.onDrain({signal});
    }
  }
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
