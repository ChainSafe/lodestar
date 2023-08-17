import {Direction, ReadStatus, Stream, StreamStatus, WriteStatus} from "@libp2p/interface/connection";
import {expect} from "chai";
import {Uint8ArrayList} from "uint8arraylist";
import {toHexString} from "@chainsafe/ssz";
import {fromHex} from "@lodestar/utils";
import {ResponseIncoming, RespStatus} from "../../src/index.js";
import {ResponseChunk} from "../fixtures/index.js";

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
  expect(chunks.map(toHexString).join("").replace(/0x/g, "")).to.deep.equal(
    expectedChunks.map(toHexString).join("").replace(/0x/g, ""),
    message
  );
}

export function expectInEqualByteChunks(chunks: Uint8Array[], expectedChunks: Uint8Array[], message?: string): void {
  expect(chunks.map(toHexString)).not.to.deep.equal(expectedChunks.map(toHexString), message);
}

/**
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
 */
export class MockLibP2pStream implements Stream {
  protocol: string;
  id = "mock";
  direction: Direction = "inbound";
  status: StreamStatus = "open";
  readStatus: ReadStatus = "ready";
  writeStatus: WriteStatus = "ready";
  timeline = {
    open: Date.now(),
  };
  metadata = {};
  source: Stream["source"];
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Uint8ArrayList[] | AsyncIterable<any> | AsyncGenerator<any>, protocol?: string) {
    this.source = Array.isArray(requestChunks)
      ? arrToSource(requestChunks)
      : (requestChunks as AsyncGenerator<Uint8ArrayList>);
    this.protocol = protocol ?? "mock";
  }

  sink: Stream["sink"] = async (source) => {
    for await (const chunk of source) {
      this.resultChunks.push(chunk.subarray());
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  close: Stream["close"] = async () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  closeRead = async (): Promise<void> => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  closeWrite = async (): Promise<void> => {};
  abort: Stream["abort"] = () => this.close();
}

export function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}

export const ZERO_HASH = Buffer.alloc(32, 0);

export const onlySuccessResp = (resp: ResponseChunk): resp is {status: RespStatus.SUCCESS; payload: ResponseIncoming} =>
  resp.status === RespStatus.SUCCESS;
