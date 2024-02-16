import {Direction, ReadStatus, Stream, StreamStatus, WriteStatus} from "@libp2p/interface";
import {logger} from "@libp2p/logger";
import {expect} from "vitest";
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
  if (message) {
    expect(chunks.map(toHexString).join("").replace(/0x/g, "")).toEqualWithMessage(
      expectedChunks.map(toHexString).join("").replace(/0x/g, ""),
      message
    );
  } else {
    expect(chunks.map(toHexString).join("").replace(/0x/g, "")).toEqual(
      expectedChunks.map(toHexString).join("").replace(/0x/g, "")
    );
  }
}

export function expectInEqualByteChunks(chunks: Uint8Array[], expectedChunks: Uint8Array[], message?: string): void {
  if (message) {
    expect(chunks.map(toHexString)).not.toEqualWithMessage(expectedChunks.map(toHexString), message);
  } else {
    expect(chunks.map(toHexString)).not.toEqual(expectedChunks.map(toHexString));
  }
}

/**
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
 */
export class MockLibP2pStream implements Stream {
  protocol: string;
  id = "mock";
  log = logger("mock");
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

  close: Stream["close"] = async () => {};
  closeRead = async (): Promise<void> => {};
  closeWrite = async (): Promise<void> => {};
  abort: Stream["abort"] = () => this.close();
}

export function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}

export const ZERO_HASH = new Uint8Array(32);

export const onlySuccessResp = (resp: ResponseChunk): resp is {status: RespStatus.SUCCESS; payload: ResponseIncoming} =>
  resp.status === RespStatus.SUCCESS;
