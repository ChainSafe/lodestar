import {XrayStreamProbe} from "@xray/probe";
import {NativeNetwork} from "@chainsafe/lodestar-z/network";
import {Logger} from "@lodestar/utils";

export class NativeXray {
  private readonly probe: XrayStreamProbe;
  private network?: NativeNetwork;
  private timer?: NodeJS.Timeout;
  private bufferedBytes = 0;
  private droppedBytes = 0n;
  private readonly errors = new Map<string, number>();

  constructor(
    address: string,
    peerId: Uint8Array,
    clientName: string,
    private readonly logger: Logger
  ) {
    this.probe = new XrayStreamProbe({
      address,
      peerId,
      clientName,
      transport: "quic-v1",
      security: "tls",
      muxer: "quic-v1",
      onError: (error) => {
        this.errors.set(error.code, (this.errors.get(error.code) ?? 0) + 1);
        logger.warn("Xray capture interrupted", {code: error.code}, error);
      },
    });
  }

  waitForAttach(): Promise<void> {
    return this.probe.waitForAttach(AbortSignal.timeout(30_000));
  }

  attach(network: NativeNetwork): void {
    this.network = network;
    this.timer = setInterval(() => {
      try {
        this.drain(4);
      } catch (error) {
        clearInterval(this.timer);
        this.errors.set("XRAY_NATIVE_CAPTURE", (this.errors.get("XRAY_NATIVE_CAPTURE") ?? 0) + 1);
        this.logger.warn("Xray native capture stopped", {code: "XRAY_NATIVE_CAPTURE"}, error as Error);
        void this.probe.stop().catch((error: unknown) => this.logger.warn("Xray close failed", {}, error as Error));
      }
    }, 5);
    this.timer.unref();
  }

  private drain(limit: number): void {
    if (!this.network) return;
    for (let i = 0; i < limit; i++) {
      const batch = this.network.drainStreamTrace();
      this.bufferedBytes = batch.bufferedBytes;
      this.droppedBytes = batch.droppedBytes;
      this.probe.capture(batch);
      if (!batch.pending) break;
    }
  }

  /** Call after the native owner stops, while its capture buffer can still be drained. */
  async close(): Promise<void> {
    clearInterval(this.timer);
    try {
      this.drain(32);
    } finally {
      await this.probe.stop();
    }
  }

  metrics(): string {
    return [
      "# HELP lodestar_xray_buffered_bytes Bytes retained in native capture and Xray replay buffers",
      "# TYPE lodestar_xray_buffered_bytes gauge",
      `lodestar_xray_buffered_bytes ${this.bufferedBytes + this.probe.bufferedBytes}`,
      "# HELP lodestar_xray_dropped_bytes_total Stream bytes discarded by native capture overflow",
      "# TYPE lodestar_xray_dropped_bytes_total counter",
      `lodestar_xray_dropped_bytes_total ${this.droppedBytes}`,
      "# HELP lodestar_xray_errors_total Xray collector and capture errors by code",
      "# TYPE lodestar_xray_errors_total counter",
      ...Array.from(this.errors, ([code, count]) => `lodestar_xray_errors_total{code="${code}"} ${count}`),
      "",
    ].join("\n");
  }
}
