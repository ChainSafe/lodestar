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
export class MockLibP2pStream implements Stream {
  protocol = "mock";
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
  maxReadBufferLength = 1024 * 1024;
  inactivityTimeout = 30000;
  writableNeedsDrain = false;
  readBufferLength = 0;
  writeBufferLength = 0;
  metadata = {};

  private inputChunks: Uint8ArrayList[];
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Uint8ArrayList[]) {
    this.inputChunks = requestChunks;
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
