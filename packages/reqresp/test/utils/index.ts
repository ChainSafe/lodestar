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

type EventHandler = (evt: Event) => void;

/**
 * Mock libp2p v3 stream for testing.
 * Implements the full MessageStream interface required by byteStream().
 *
 * Key design: Data emission is deferred until after event listeners are attached.
 * This matches real libp2p behavior where streams emit data asynchronously.
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
  timeline = {
    open: Date.now(),
  };
  metadata = {};
  maxReadBufferLength = 4_194_304;
  maxWriteBufferLength = 4_194_304;
  inactivityTimeout = 30_000;
  writableNeedsDrain = false;
  readBufferLength = 0;
  writeBufferLength = 0;

  private readBuffer: Uint8ArrayList[] = [];
  resultChunks: Uint8Array[] = [];

  private eventListeners = new Map<string, Set<EventHandler>>();
  private inputSource: AsyncIterable<Uint8ArrayList | Uint8Array>;
  private sourceStarted = false;

  constructor(requestChunks: Uint8ArrayList[] | AsyncIterable<Uint8ArrayList | Uint8Array>, protocol?: string) {
    if (Array.isArray(requestChunks)) {
      this.inputSource = arrToSource(requestChunks);
    } else {
      this.inputSource = requestChunks;
    }
    this.protocol = protocol ?? "mock";

    // Don't start source immediately - wait for message listeners to be attached
    // This matches real libp2p stream behavior where data arrives asynchronously
  }

  private async startSource(): Promise<void> {
    if (this.sourceStarted) return;
    this.sourceStarted = true;

    try {
      // Collect all chunks into a single buffer to emit as one message
      // This matches how byteStream expects data - as a continuous stream
      const allData = new Uint8ArrayList();
      for await (const chunk of this.inputSource) {
        const data = chunk instanceof Uint8ArrayList ? chunk : new Uint8ArrayList(chunk);
        allData.append(data);
      }

      // Emit all data as a single message
      if (allData.byteLength > 0) {
        this.emitMessage(allData);
      }
    } catch (err) {
      this.emitClose(err as Error);
      return;
    }

    // Signal EOF after a short delay to allow byteStream to process the data
    // The delay needs to be long enough for async reads to complete
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.remoteWriteStatus = "closed";
    this.emitRemoteCloseWrite();
  }

  private emitMessage(data: Uint8ArrayList): void {
    const evt = new CustomEvent("message", {detail: data}) as unknown as {
      type: "message";
      data: Uint8ArrayList;
    };
    (evt as any).data = data; // libp2p uses .data not .detail
    this.dispatchEvent(evt as unknown as Event);
  }

  private emitRemoteCloseWrite(): void {
    const evt = new Event("remoteCloseWrite");
    this.dispatchEvent(evt);
  }

  private emitClose(error?: Error): void {
    const evt = new CustomEvent("close", {detail: {error, local: false}}) as unknown as Event;
    (evt as any).error = error;
    (evt as any).local = false;
    this.dispatchEvent(evt);
  }

  // libp2p v3: Streams implement AsyncIterable
  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8ArrayList> {
    for await (const chunk of this.inputSource) {
      yield chunk instanceof Uint8ArrayList ? chunk : new Uint8ArrayList(chunk);
    }
  }

  // libp2p v3: send method for writing
  send(data: Uint8Array | Uint8ArrayList): boolean {
    const bytes = data instanceof Uint8ArrayList ? data.subarray() : data;
    this.resultChunks.push(bytes);
    return true;
  }

  // libp2p v3: push method for receiving data (required by byteStream validation)
  push(buf: Uint8Array | Uint8ArrayList): void {
    const data = buf instanceof Uint8ArrayList ? buf : new Uint8ArrayList(buf);
    this.readBuffer.push(data);
    this.readBufferLength += data.byteLength;
    this.emitMessage(data);
  }

  // libp2p v3: unshift method
  unshift(data: Uint8Array | Uint8ArrayList): void {
    const buf = data instanceof Uint8ArrayList ? data : new Uint8ArrayList(data);
    this.readBuffer.unshift(buf);
    this.readBufferLength += buf.byteLength;
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
    this.emitClose();
  };
  closeRead = async (): Promise<void> => {
    this.readStatus = "closed";
  };
  abort = (err?: Error): void => {
    this.status = "aborted";
    this.emitClose(err);
  };

  // EventTarget methods - proper implementation for byteStream
  addEventListener(type: string, listener: EventHandler): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)?.add(listener);

    // Start pumping data when a 'message' listener is added
    // Use queueMicrotask to allow all listeners to be registered first
    if (type === "message" && !this.sourceStarted) {
      queueMicrotask(() => {
        void this.startSource();
      });
    }
  }

  removeEventListener(type: string, listener: EventHandler): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  dispatchEvent(evt: Event): boolean {
    const listeners = this.eventListeners.get(evt.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(evt);
      }
    }
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
}

export function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}

export const ZERO_HASH = new Uint8Array(32);

export const onlySuccessResp = (resp: ResponseChunk): resp is {status: RespStatus.SUCCESS; payload: ResponseIncoming} =>
  resp.status === RespStatus.SUCCESS;
