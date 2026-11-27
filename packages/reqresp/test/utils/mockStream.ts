import type {Logger, Stream} from "@libp2p/interface";
import {StreamMessageEvent} from "@libp2p/interface";
import {AbstractStream, SendResult, streamPair} from "@libp2p/utils";
import {Uint8ArrayList} from "uint8arraylist";

type SourceChunk = Uint8Array | Uint8ArrayList;

const noopLogger: Logger = Object.assign(() => {}, {
  enabled: false,
  error: () => {},
  trace: () => {},
  newScope: () => noopLogger,
});

/**
 * Stream over a transport whose peer reads only when the test says so. Its send window starts closed, so
 * writes accumulate in the stream write buffer; drain(bytes) reopens the window for that many bytes to
 * simulate the peer reading. The stream's own continueSendingOnDrain defers the flush to a microtask, so
 * the window is a byte budget (not a transient flag) that survives until that flush runs.
 */
export class SlowReaderStream extends AbstractStream {
  writtenBytes = 0;
  private windowBytes = 0;

  constructor() {
    super({id: "slow-reader", log: noopLogger, direction: "inbound"});
  }

  /** Simulate the peer reading: reopen the transport window for up to `bytes` more bytes */
  drain(bytes = Number.MAX_SAFE_INTEGER): void {
    this.windowBytes = bytes;
    this.onMuxerDrain();
  }

  sendData(data: Uint8ArrayList): SendResult {
    if (this.windowBytes <= 0) {
      return {sentBytes: 0, canSendMore: false};
    }
    const sentBytes = Math.min(data.byteLength, this.windowBytes);
    this.windowBytes -= sentBytes;
    this.writtenBytes += sentBytes;
    return {sentBytes, canSendMore: this.windowBytes > 0};
  }

  sendReset(): void {}
  async sendCloseWrite(): Promise<void> {}
  async sendCloseRead(): Promise<void> {}
  sendPause(): void {}
  sendResume(): void {}
}

/**
 * Minimal stream test double for reqresp tests backed by upstream streamPair.
 * Pumps source data into one side and returns the other for the code-under-test.
 * Captures data sent back through the stream in sentChunks.
 */
export async function createMockStream({
  protocol = "",
  source = (async function* (): AsyncIterable<SourceChunk> {})(),
}: {
  protocol?: string;
  source?: AsyncIterable<SourceChunk>;
} = {}): Promise<{stream: Stream; sentChunks: Uint8Array[]}> {
  const [writer, reader] = await streamPair({protocol, delay: 0});
  const sentChunks: Uint8Array[] = [];

  // streamPair only sets protocol on the outbound stream; mirror it to the inbound
  reader.protocol = protocol;

  // Capture data sent back through the reader stream (received on writer side)
  writer.addEventListener("message", (evt: StreamMessageEvent) => {
    const data = evt.data;
    sentChunks.push(data instanceof Uint8ArrayList ? data.subarray() : data);
  });

  // Pump source data into the writer side so the reader can consume it.
  // Use close() to signal EOF — AbstractStream.close() sends closeWrite to the
  // remote, which is what byteStream uses to detect end-of-stream.
  void (async () => {
    try {
      for await (const chunk of source) {
        const data = chunk instanceof Uint8ArrayList ? chunk : new Uint8ArrayList(chunk);
        writer.send(data);
      }
    } catch {
      // Sources may abort on purpose to simulate timeouts
    }
    await writer.close();
  })();

  return {stream: reader, sentChunks};
}
