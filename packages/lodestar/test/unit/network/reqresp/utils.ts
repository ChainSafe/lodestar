import {expect} from "chai";
import {Root, SignedBeaconBlock, Status} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
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

export function expectLodestarError<T extends {code: string}>(err1: LodestarError<T>, err2: LodestarError<T>): void {
  if (!(err1 instanceof LodestarError)) throw Error(`err1 not instanceof LodestarError: ${(err1 as Error).stack}`);
  if (!(err2 instanceof LodestarError)) throw Error(`err2 not instanceof LodestarError: ${(err2 as Error).stack}`);

  expect(err1.getMetadata()).to.deep.equal(err2.getMetadata(), "Wrong LodestarError metadata");
}

export function generateEmptySignedBlocks(n = 3): SignedBeaconBlock[] {
  return Array.from({length: n}).map(() => generateEmptySignedBlock());
}
