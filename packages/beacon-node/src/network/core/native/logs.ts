import {NativeLogLevel, NativeLogLoss, NativeLogRecord} from "@chainsafe/lodestar-z/network";
import {logLevelNum} from "@lodestar/logger";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";

/** Native thresholds by Lodestar level verbosity; native has no verbose or trace records. */
const nativeLevels: NativeLogLevel[] = ["error", "warn", "info", "info", "debug", "debug"];

/**
 * The native threshold that keeps every record some output of the logger prints: the console's level for the logger's
 * module, or the file's level if lower.
 */
export function nativeLogLevel({level, module, levelModule, file}: LoggerNodeOpts): NativeLogLevel {
  const consoleLevel = (module !== undefined ? levelModule?.[module] : undefined) ?? level;
  const verbosity = Math.max(logLevelNum[consoleLevel], file ? logLevelNum[file.level] : 0);
  return nativeLevels[verbosity];
}

/** Hands native log records to Lodestar's logger with their native context. */
export class NativeLogs {
  readonly level: NativeLogLevel;
  constructor(private readonly logger: LoggerNode) {
    this.level = nativeLogLevel(logger.toOpts());
  }

  deliver(records: readonly NativeLogRecord[], lost: NativeLogLoss | null): void {
    for (const record of records)
      this.logger[record.level](record.message, {
        nativeScope: record.scope,
        nativeSequence: record.sequence.toString(),
        nativeTimestampMs: record.timestampMs.toString(),
        nativeMonotonicMs: record.monotonicMs.toString(),
        nativeTruncated: record.truncated,
      });
    if (lost)
      this.logger.warn("Native log records limited", {
        dropped: lost.dropped.toString(),
        suppressed: lost.suppressed.toString(),
        truncated: lost.truncated.toString(),
      });
  }
}
