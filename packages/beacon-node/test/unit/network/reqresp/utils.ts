import type {
  AbortOptions,
  MessageStreamDirection,
  MessageStreamReadStatus,
  MessageStreamStatus,
  MessageStreamWriteStatus,
  Stream,
} from "@libp2p/interface";
import {logger} from "@libp2p/logger";
import {Uint8ArrayList} from "uint8arraylist";
import {expect} from "vitest";
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
export class MockLibP2pStream extends EventTarget implements Stream {
  id = "mock";
  log = logger("mock");
  direction: MessageStreamDirection = "inbound";
  timeline = {
    open: Date.now(),
  };
  status: MessageStreamStatus = "open";
  readStatus: MessageStreamReadStatus = "readable";
  writeStatus: MessageStreamWriteStatus = "writable";
  remoteReadStatus: MessageStreamReadStatus = "readable";
  remoteWriteStatus: MessageStreamWriteStatus = "writable";
  maxReadBufferLength = Number.POSITIVE_INFINITY;
  maxWriteBufferLength = Number.POSITIVE_INFINITY;
  inactivityTimeout = 0;
  writableNeedsDrain = false;
  readBufferLength = 0;
  writeBufferLength = 0;
  private source: AsyncIterable<Uint8ArrayList | Uint8Array>;
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Uint8ArrayList[]) {
    super();
    this.source = arrToSource(requestChunks);
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | Uint8ArrayList> {
    return this.source[Symbol.asyncIterator]();
  }

  send(data: Uint8Array | Uint8ArrayList): boolean {
    const chunk = data instanceof Uint8ArrayList ? data.subarray() : data;
    this.resultChunks.push(chunk);
    return true;
  }

  async close(_options?: AbortOptions): Promise<void> {
    this.writeStatus = "closed";
    this.status = "closed";
  }

  async closeRead(_options?: AbortOptions): Promise<void> {
    this.readStatus = "closed";
  }

  abort(_err: Error): void {
    this.status = "aborted";
  }

  pause(): void {}
  resume(): void {}
  push(_data: Uint8Array | Uint8ArrayList): void {}
  unshift(_data: Uint8Array | Uint8ArrayList): void {}
  async onDrain(_options?: AbortOptions): Promise<void> {}
}
