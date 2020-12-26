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

export async function expectRejectedWithLodestarError(
  promise: Promise<any>,
  expectedErr: LodestarError<any>
): Promise<void> {
  try {
    const value = await promise;
    const json = JSON.stringify(value, null, 2);
    throw Error(`Expected promise to reject but returned value: \n\n\t${json}`);
  } catch (e) {
    expectLodestarError(e, expectedErr);
  }
}

export function expectLodestarError<T extends {code: string}>(err1: LodestarError<T>, err2: LodestarError<T>): void {
  if (!(err1 instanceof LodestarError)) throw Error(`err1 not instanceof LodestarError: ${(err1 as Error).stack}`);
  if (!(err2 instanceof LodestarError)) throw Error(`err2 not instanceof LodestarError: ${(err2 as Error).stack}`);

  expect(getErrorMetadata(err1)).to.deep.equal(getErrorMetadata(err2), "Wrong LodestarError metadata");
}

export function getErrorMetadata<T extends {code: string}>(err: LodestarError<T> | Error | Json): Json {
  if (err instanceof LodestarError) {
    return mapValues(err.getMetadata(), (value) => getErrorMetadata(value));
  } else if (err instanceof Error) {
    return err.message;
  } else {
    return err;
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
