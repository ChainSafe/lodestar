import {
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
import {fromHex} from "@lodestar/utils";
import {RespStatus, ResponseIncoming} from "../../src/index.js";
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
 * Mock libp2p v3 stream for testing.
 * Implements the EventTarget-based stream interface with message events.
 */
export class MockLibP2pStream implements Stream {
  protocol: string;
  id = "mock";
  log = logger("mock");
  direction: MessageStreamDirection = "inbound";
  status: MessageStreamStatus = "open";
  readStatus: MessageStreamReadStatus = "readable";
  writeStatus: MessageStreamWriteStatus = "writable";
  remoteReadStatus: MessageStreamReadStatus = "readable";
  remoteWriteStatus: MessageStreamWriteStatus = "writable";
  maxReadBufferLength = 1024 * 1024;
  inactivityTimeout = 30000;
  writableNeedsDrain = false;
  readBufferLength = 0;
  writeBufferLength = 0;
  timeline = {
    open: Date.now(),
  };
  metadata = {};

  private inputChunks: Uint8ArrayList[] = [];
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Uint8ArrayList[] | AsyncIterable<any> | AsyncGenerator<any>, protocol?: string) {
    // Convert async iterable to array if needed
    if (Array.isArray(requestChunks)) {
      this.inputChunks = requestChunks;
    } else {
      // For backwards compatibility, store reference and handle async
      this.inputChunks = [];
      (async () => {
        for await (const chunk of requestChunks) {
          this.inputChunks.push(chunk instanceof Uint8ArrayList ? chunk : new Uint8ArrayList(chunk));
        }
      })();
    }
    this.protocol = protocol ?? "mock";
  }

  // libp2p v3: Streams implement AsyncIterable
  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8ArrayList> {
    for (const chunk of this.inputChunks) {
      yield chunk;
    }
  }

  // libp2p v3: send method for writing
  send(data: Uint8Array | Uint8ArrayList): boolean {
    const bytes = data instanceof Uint8ArrayList ? data.subarray() : data;
    this.resultChunks.push(bytes);
    return true;
  }

  // libp2p v3: onDrain for backpressure
  async onDrain(): Promise<void> {
    // No-op for tests
  }

  // For backwards compatibility with byteStream wrapper
  get source(): AsyncIterable<Uint8ArrayList> {
    return this[Symbol.asyncIterator]();
  }

  // Sink for backwards compatibility
  sink = async (source: AsyncIterable<Uint8Array | Uint8ArrayList>): Promise<void> => {
    for await (const chunk of source) {
      const bytes = chunk instanceof Uint8ArrayList ? chunk.subarray() : chunk;
      this.resultChunks.push(bytes);
    }
  };

  close = async (): Promise<void> => {
    this.status = "closed";
  };
  closeRead = async (): Promise<void> => {
    this.readStatus = "closed";
  };
  closeWrite = async (): Promise<void> => {
    this.writeStatus = "closed";
  };
  abort = (_err: Error): void => {
    this.status = "aborted";
  };

  // EventTarget methods (no-op for basic tests)
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
  listenerCount(_type: string): number {
    return 0;
  }
  safeDispatchEvent(_type: string, _detail?: CustomEventInit<unknown>): boolean {
    return true;
  }

  // Pause/resume for backpressure
  pause(): void {}
  resume(): void {}

  // Push/unshift for buffer management
  push(_buf: Uint8Array | Uint8ArrayList): void {}
  unshift(_data: Uint8Array | Uint8ArrayList): void {}
}

export function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}

export const ZERO_HASH = new Uint8Array(32);

export const onlySuccessResp = (resp: ResponseChunk): resp is {status: RespStatus.SUCCESS; payload: ResponseIncoming} =>
  resp.status === RespStatus.SUCCESS;
