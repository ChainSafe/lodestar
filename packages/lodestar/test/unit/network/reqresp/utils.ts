import {expect} from "chai";
import {Root, SignedBeaconBlock, Status} from "@chainsafe/lodestar-types";
import {LodestarError, mapValues} from "@chainsafe/lodestar-utils";
import {fromHexString, Json, List} from "@chainsafe/ssz";
import {ILibP2pStream} from "../../../../src/network";
import {generateEmptySignedBlock} from "../../../utils/block";

export function createStatus(): Status {
  return {
    finalizedEpoch: 1,
    finalizedRoot: Buffer.alloc(32, 0),
    forkDigest: Buffer.alloc(4),
    headRoot: Buffer.alloc(32, 0),
    headSlot: 10,
  };
}

export function generateRoots(count: number, offset = 0): List<Root> {
  const roots: Root[] = [];
  for (let i = 0; i < count; i++) {
    roots.push(Buffer.alloc(32, i + offset));
  }
  return roots as List<Root>;
}

/**
 * Helper to type calling `type.equals` with a union of SSZ types
 */
export function isEqualSszType<T>(type: {equals: (a: any, b: any) => boolean}, a: T, b: T): boolean {
  return type.equals(a, b);
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

export function generateEmptySignedBlocks(n = 3): SignedBeaconBlock[] {
  return Array.from({length: n}).map(() => generateEmptySignedBlock());
}

/**
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
 */
export class MockLibP2pStream implements ILibP2pStream {
  source: ILibP2pStream["source"];
  resultChunks: Buffer[] = [];
  isClosed = false;

  constructor(requestChunks: string[]) {
    this.source = arrToSource(requestChunks.map((hex) => Buffer.from(fromHexString(hex))));
  }

  sink: ILibP2pStream["sink"] = async (source) => {
    for await (const chunk of source) {
      this.resultChunks.push(chunk);
    }
  };
  close: ILibP2pStream["close"] = () => (this.isClosed = true);
  reset: ILibP2pStream["reset"] = () => this.close();
}
