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
 * Useful to simulate a LibP2P stream source emitting prepared bytes
 * and capture the response with a sink accessible via `this.resultChunks`
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
  maxReadBufferLength = Number.POSITIVE_INFINITY;
  maxWriteBufferLength: number | undefined = undefined;
  inactivityTimeout = 0;
  writableNeedsDrain = false;
  readBufferLength = 0;
  writeBufferLength = 0;
  timeline = {
    open: Date.now(),
  };
  private readonly source: AsyncIterable<Uint8Array | Uint8ArrayList>;
  resultChunks: Uint8Array[] = [];
  private readonly eventTarget = new EventTarget();
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor(
    requestChunks: Array<Uint8Array | Uint8ArrayList> | AsyncIterable<Uint8Array | Uint8ArrayList>,
    protocol?: string
  ) {
    this.source = Array.isArray(requestChunks)
      ? arrToSource(requestChunks)
      : requestChunks;
    this.protocol = protocol ?? "mock";
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
      const existing = this.listeners.get(type as string);
      existing?.delete(listener);
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

export function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}

export const ZERO_HASH = new Uint8Array(32);

export const onlySuccessResp = (resp: ResponseChunk): resp is {status: RespStatus.SUCCESS; payload: ResponseIncoming} =>
  resp.status === RespStatus.SUCCESS;
