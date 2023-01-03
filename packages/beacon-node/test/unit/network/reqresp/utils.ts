import {expect} from "chai";
import {Stream, StreamStat} from "@libp2p/interface-connection";
import {Uint8ArrayList} from "uint8arraylist";
import {Root} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";

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
export function expectEqualByteChunks(chunks: Uint8Array[], expectedChunks: Uint8Array[], message?: string): void {
  expect(chunks.map(toHexString)).to.deep.equal(expectedChunks.map(toHexString), message);
}

/**
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
 */
export class MockLibP2pStream implements Stream {
  id = "mock";
  stat = {
    direction: "inbound",
    timeline: {
      open: Date.now(),
    },
  } as StreamStat;
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
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  close: Stream["close"] = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  closeRead = (): void => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  closeWrite = (): void => {};
  reset: Stream["reset"] = () => this.close();
  abort: Stream["abort"] = () => this.close();
}
