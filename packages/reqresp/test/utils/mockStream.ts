import type {Stream} from "@libp2p/interface";
import {Uint8ArrayList} from "uint8arraylist";

type SourceChunk = Uint8Array | Uint8ArrayList;

function toUint8ArrayList(chunk: SourceChunk): Uint8ArrayList {
  return chunk instanceof Uint8ArrayList ? chunk : new Uint8ArrayList(chunk);
}

function toUint8Array(chunk: SourceChunk): Uint8Array {
  return chunk instanceof Uint8ArrayList ? chunk.subarray() : chunk;
}

/**
 * Minimal stream test double for reqresp tests.
 * It captures sent chunks and yields a provided source for reads.
 */
export function createMockStream({
  protocol = "",
  source = (async function* (): AsyncIterable<SourceChunk> {})(),
}: {
  protocol?: string;
  source?: AsyncIterable<SourceChunk>;
} = {}): {stream: Stream; sentChunks: Uint8Array[]} {
  const sentChunks: Uint8Array[] = [];

  const stream = {
    protocol,
    send(chunk: SourceChunk): boolean {
      sentChunks.push(toUint8Array(chunk));
      return true;
    },
    async onDrain(): Promise<void> {},
    async close(): Promise<void> {},
    abort(): void {},
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8ArrayList> {
      for await (const chunk of source) {
        yield toUint8ArrayList(chunk);
      }
    },
  } as unknown as Stream;

  return {stream, sentChunks};
}
