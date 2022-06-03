import {expect} from "chai";
import {Stream} from "@libp2p/interface-connection";
import {Root, phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {generateEmptySignedBlock} from "../../../utils/block.js";

export function createStatus(): phase0.Status {
  return {
    finalizedEpoch: 1,
    finalizedRoot: Buffer.alloc(32, 0),
    forkDigest: Buffer.alloc(4),
    headRoot: Buffer.alloc(32, 0),
    headSlot: 10,
  };
}

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

export function generateEmptySignedBlocks(n = 3): phase0.SignedBeaconBlock[] {
  return Array.from({length: n}).map(() => generateEmptySignedBlock());
}

/**
 * Wrapper for type-safety to ensure and array of Buffers is equal with a diff in hex
 */
export function expectEqualByteChunks(chunks: Buffer[], expectedChunks: Buffer[], message?: string): void {
  expect(chunks.map(toHexString)).to.deep.equal(expectedChunks.map(toHexString), message);
}

/**
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
 */
export class MockLibP2pStream implements Stream {
  id = "mock";
  timeline = {
    open: Date.now(),
  };
  source: Stream["source"];
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Buffer[]) {
    this.source = arrToSource(requestChunks);
  }
  sink: Stream["sink"] = async (source) => {
    for await (const chunk of source) {
      this.resultChunks.push(chunk);
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
