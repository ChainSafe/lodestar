import {expect} from "vitest";
import {Direction, ReadStatus, Stream, StreamStatus, WriteStatus} from "@libp2p/interface";
import {logger} from "@libp2p/logger";
import {Uint8ArrayList} from "uint8arraylist";
import {toHexString} from "@chainsafe/ssz";
import {Root} from "@lodestar/types";

export function generateRoots(count: number, offset = 0): Root[] {
  const roots: Root[] = [];
  for (let i = 0; i < count; i++) {
    roots.push(Buffer.alloc(32, i + offset));
  }
  return roots;
}

/**
 * Helper for it-pipe when first argument is an array.
 * it-pipe does not convert the chunks array to a generator and BufferedSource breaks
 */
export async function* arrToSource<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) {
    yield item;
  }
}

/**
 * Wrapper for type-safety to ensure and array of Buffers is equal with a diff in hex
 */
export function expectEqualByteChunks(chunks: Uint8Array[], expectedChunks: Uint8Array[]): void {
  expect(chunks.map(toHexString)).toEqual(expectedChunks.map(toHexString));
}

/**
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
 */
export class MockLibP2pStream implements Stream {
  id = "mock";
  log = logger("mock");
  direction: Direction = "inbound";
  timeline = {
    open: Date.now(),
  };
  status: StreamStatus = "open";
  readStatus: ReadStatus = "ready";
  writeStatus: WriteStatus = "ready";
  metadata = {};
  source: Stream["source"];
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Uint8ArrayList[]) {
    this.source = arrToSource(requestChunks);
  }
  sink: Stream["sink"] = async (source) => {
    for await (const chunk of source) {
      this.resultChunks.push(chunk.subarray());
    }
  };
  close: Stream["close"] = async () => {};
  closeRead = async (): Promise<void> => {};
  closeWrite = async (): Promise<void> => {};
  abort: Stream["abort"] = () => this.close();
}
