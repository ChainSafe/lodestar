import {expect} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {fromHex} from "@lodestar/utils";
import {RespStatus, ResponseIncoming} from "../../src/index.js";
import {ResponseChunk} from "../fixtures/index.js";

/**
 * Converts an array to an async source.
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

export function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}

export const ZERO_HASH = new Uint8Array(32);

export const onlySuccessResp = (resp: ResponseChunk): resp is {status: RespStatus.SUCCESS; payload: ResponseIncoming} =>
  resp.status === RespStatus.SUCCESS;
