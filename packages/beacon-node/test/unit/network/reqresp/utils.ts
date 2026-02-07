import {
  MessageStreamDirection,
  MessageStreamEvents,
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
  maxWriteBufferLength: number | undefined = undefined;
  inactivityTimeout = 0;
  writableNeedsDrain = false;
  readBufferLength = 0;
  writeBufferLength = 0;
  protocol = "mock";
  private readonly eventTarget = new EventTarget();
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private readonly source: AsyncIterable<Uint8Array | Uint8ArrayList>;
  resultChunks: Uint8Array[] = [];

  constructor(requestChunks: Array<Uint8Array | Uint8ArrayList>) {
    this.source = arrToSource(requestChunks);
  }
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | Uint8ArrayList> {
    return this.source[Symbol.asyncIterator]();
  }
  addEventListener(...args: Parameters<Stream["addEventListener"]>): void {
    const [type, listener, options] = args;
    this.eventTarget.addEventListener(type as string, listener as EventListener, options);
    if (listener) {
      const existing = this.listeners.get(type as string) ?? new Set<EventListenerOrEventListenerObject>();
      existing.add(listener);
      this.listeners.set(type as string, existing);
    }
  }
  removeEventListener(...args: Parameters<Stream["removeEventListener"]>): void {
    const [type, listener, options] = args;
    this.eventTarget.removeEventListener(type as string, listener as EventListener, options);
    if (listener) {
      this.listeners.get(type as string)?.delete(listener);
    }
  }
  dispatchEvent(event: Parameters<Stream["dispatchEvent"]>[0]): boolean {
    return this.eventTarget.dispatchEvent(event as Event);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  safeDispatchEvent<Detail>(type: keyof MessageStreamEvents, detail?: CustomEventInit<Detail>): boolean {
    return this.dispatchEvent(new CustomEvent(type as string, detail));
  }
  send(data: Uint8Array | Uint8ArrayList): boolean {
    const chunk = data instanceof Uint8ArrayList ? data.subarray() : data;
    this.resultChunks.push(chunk);
    return true;
  }
  close: Stream["close"] = async () => {};
  closeRead = async (): Promise<void> => {};
  abort: Stream["abort"] = () => this.close();
  pause(): void {}
  resume(): void {}
  push(_buf: Uint8Array | Uint8ArrayList): void {}
  unshift(_data: Uint8Array | Uint8ArrayList): void {}
  onDrain = async (): Promise<void> => {};
}
