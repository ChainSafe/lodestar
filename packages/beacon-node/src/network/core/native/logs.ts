import {NativeNetwork} from "@chainsafe/lodestar-z/network";
import {Logger} from "@lodestar/utils";

export class NativeLogs {
  deliveryErrors = 0;
  private readonly timer: NodeJS.Timeout;
  private reportedDropped = 0n;
  private reportedSuppressed = 0n;
  private reportedTruncated = 0n;
  private lastWarning = 0;

  constructor(
    private readonly network: Pick<NativeNetwork, "drainLogs" | "setLogLevel">,
    private readonly logger: Logger
  ) {
    network.setLogLevel("debug");
    this.timer = setInterval(() => this.drain(1), 250);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
    this.drain(4);
  }

  private drain(batches: number): void {
    try {
      for (let i = 0; i < batches; i++) {
        const batch = this.network.drainLogs(32);
        for (const record of batch.records) {
          try {
            this.logger[record.level](record.message, {
              nativeScope: record.scope,
              nativeSequence: record.sequence.toString(),
              nativeTimestampMs: record.timestampMs.toString(),
              nativeMonotonicMs: record.monotonicMs.toString(),
              nativeTruncated: record.truncated,
            });
          } catch {
            this.deliveryErrors++;
          }
        }
        const now = Date.now();
        if (
          now - this.lastWarning >= 30000 &&
          (batch.dropped > this.reportedDropped || batch.truncated > this.reportedTruncated)
        ) {
          const loss = {
            dropped: (batch.dropped - this.reportedDropped).toString(),
            suppressed: (batch.suppressed - this.reportedSuppressed).toString(),
            truncated: (batch.truncated - this.reportedTruncated).toString(),
          };
          this.lastWarning = now;
          this.reportedDropped = batch.dropped;
          this.reportedSuppressed = batch.suppressed;
          this.reportedTruncated = batch.truncated;
          this.logger.warn("Native log records limited", loss);
        }
        if (!batch.more) break;
      }
    } catch (error) {
      this.deliveryErrors++;
      if (Date.now() - this.lastWarning >= 30000) {
        this.lastWarning = Date.now();
        try {
          this.logger.warn("Native log delivery failed", {}, error as Error);
        } catch {
          this.deliveryErrors++;
        }
      }
    }
  }
}
