import type {LoggerOptions as PinoLoggerOptions} from "pino";
import pino from "pino";
import pinoPretty from "pino-pretty";
import {LodestarError, isEmptyObject} from "@lodestar/utils";
import {LogLevel, Logger, TimestampFormat, TimestampFormatCode} from "./interface.js";
import {PinoLogger} from "./pino.js";
import {logCtxToJson, logCtxToString} from "./utils/json.js";
import {formatEpochSlotTime} from "./utils/timeFormat.js";

export type LoggerNodeOpts = {
  level: LogLevel;
  /**
   * Enable file output transport if set
   */
  file?: {
    filepath: string;
    /**
     * Log level for file output transport
     */
    level: LogLevel;
    /**
     * Rotation config for file output transport
     */
    dailyRotate?: number;
  };
  /**
   * Module prefix for all logs
   */
  module?: string;
  /**
   * Rendering format for logs, defaults to "human"
   */
  format?: "human" | "json";
  /**
   * Set specific log levels by module
   */
  levelModule?: Record<string, LogLevel>;
  /**
   * Enables relative to genesis timestamp format
   * ```
   * timestampFormat = {
   *   format: TimestampFormatCode.EpochSlot,
   *   genesisTime: args.logFormatGenesisTime,
   *   secondsPerSlot: config.SECONDS_PER_SLOT,
   *   slotsPerEpoch: SLOTS_PER_EPOCH,
   * }
   * ```
   */
  timestampFormat?: TimestampFormat;
};

export type LoggerNodeChildOpts = {
  module?: string;
};

export type LoggerNode = Logger & {
  toOpts(): LoggerNodeOpts;
  child(opts: LoggerNodeChildOpts): LoggerNode;
};

/**
 * Setup a CLI logger, common for beacon, validator and dev commands
 */
export function getNodeLogger(opts: LoggerNodeOpts): LoggerNode {
  return PinoLoggerNode.fromOpts(opts);
}

// Map our log levels to pino levels
const levelToPinoLevel: Record<LogLevel, string> = {
  [LogLevel.error]: "error",
  [LogLevel.warn]: "warn",
  [LogLevel.info]: "info",
  [LogLevel.verbose]: "debug",
  [LogLevel.debug]: "debug",
  [LogLevel.trace]: "trace",
};

export class PinoLoggerNode extends PinoLogger implements LoggerNode {
  private levelByModule = new Map<string, LogLevel>();

  constructor(
    protected readonly pino: pino.Logger,
    private readonly opts: LoggerNodeOpts
  ) {
    super(pino);

    // Set module levels if provided
    if (opts.levelModule) {
      for (const [module, level] of Object.entries(opts.levelModule)) {
        this.levelByModule.set(module, level);
      }
    }
  }

  static fromOpts(opts: LoggerNodeOpts): PinoLoggerNode {
    const pinoLogger = PinoLoggerNode.createNodePinoInstance(opts);
    return new PinoLoggerNode(pinoLogger, opts);
  }

  static createNodePinoInstance(opts: LoggerNodeOpts): pino.Logger {
    const module = opts.module || "";

    // For console output, we'll use a custom prettifier directly on the main logger
    // instead of using transports to avoid worker thread issues
    if (!opts.file || opts.format === "human") {
      // Human-readable format for console - use pino-pretty directly
      const stream = getPrettyStream(opts);

      const pinoOptions: PinoLoggerOptions = {
        level: levelToPinoLevel[opts.level],
        base: {module},
        formatters: {
          level: (label) => ({level: label}),
          bindings: (bindings) => ({module: bindings.module || module})
        }
      };

      // If we have a file transport, we need to use multistream
      if (opts.file) {
        const multistream = pino.multistream([
          {stream, level: levelToPinoLevel[opts.level]},
          getFileStream(opts)
        ]);
        return pino(pinoOptions, multistream);
      }

      // Console only
      return pino(pinoOptions, stream);
    } else {
      // JSON format - simpler setup
      const pinoOptions: PinoLoggerOptions = {
        level: levelToPinoLevel[opts.level],
        base: {module},
        formatters: {
          level: (label) => ({level: label}),
          bindings: (bindings) => ({module: bindings.module || module}),
          log: (obj) => {
            if (obj.context) obj.context = logCtxToJson(obj.context);
            if (obj.error) obj.error = logCtxToJson(obj.error);
            return obj;
          }
        }
      };

      if (opts.file) {
        const multistream = pino.multistream([
          {stream: process.stdout, level: levelToPinoLevel[opts.level]},
          getFileStream(opts)
        ]);
        return pino(pinoOptions, multistream);
      }

      return pino(pinoOptions);
    }
  }

  child(opts: LoggerNodeChildOpts): LoggerNode {
    const currentModule = this.opts.module || "";
    const childModule = [currentModule, opts.module].filter(Boolean).join("/");
    const childOpts: LoggerNodeOpts = {...this.opts, module: childModule};

    const childPino = this.pino.child({module: childModule});
    return new PinoLoggerNode(childPino, childOpts);
  }

  toOpts(): LoggerNodeOpts {
    return this.opts;
  }

  // Override createLogEntry to check module levels
  // biome-ignore lint/suspicious/noExplicitAny: LogData compatibility
  protected createLogEntry(level: LogLevel, message: string, context?: any, error?: Error): void {
    const module = this.pino.bindings().module || "";
    const moduleLevel = this.levelByModule.get(module) ?? this.opts.level;

    // Check if this log should be output based on module level
    const levelNum = {
      [LogLevel.error]: 0,
      [LogLevel.warn]: 1,
      [LogLevel.info]: 2,
      [LogLevel.verbose]: 3,
      [LogLevel.debug]: 4,
      [LogLevel.trace]: 5,
    };

    if (levelNum[level] > levelNum[moduleLevel]) {
      return; // Skip this log
    }

    super.createLogEntry(level, message, context, error);
  }
}

function getPrettyStream(opts: LoggerNodeOpts): NodeJS.WritableStream {
  // Use pino-pretty programmatically for better control
  return pinoPretty({
    colorize: true,
    translateTime: opts.timestampFormat?.format === TimestampFormatCode.Hidden
      ? false
      : "SYS:mmm-dd HH:MM:ss.l",
    // biome-ignore lint/suspicious/noExplicitAny: Pino log object type
    messageFormat: (log: any, messageKey: string) => {
      const msg = log[messageKey];
      const moduleStr = String(log.module || "");
      const paddingBetweenInfo = 30;
      const infoPad = paddingBetweenInfo - moduleStr.length;

      let str = "";
      // Handle epoch/slot time format
      if (opts.timestampFormat?.format === TimestampFormatCode.EpochSlot) {
        // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for EpochSlot format
        str += formatEpochSlotTime(opts.timestampFormat as any) + " ";
      }
      if (moduleStr) {
        str += `[${moduleStr}]`;
      }
      const levelStr = String(log.level || "");
      str += ` ${levelStr.padStart(infoPad)}: ${msg}`;

      // Add context if present
      if (log.context && !isEmptyObject(log.context)) {
        str += " " + logCtxToString(log.context);
      }

      // Add error if present
      if (log.error) {
        const error = log.error;
        if (error instanceof LodestarError) {
          str += (isEmptyObject(log.context) ? " " : ", ") + logCtxToString(error);
        } else if (error instanceof Error) {
          str += " - " + error.message;
          if (error.stack) str += "\n" + error.stack;
        } else {
          str += " - " + logCtxToString(error);
        }
      }

      return str;
    },
    ignore: "pid,hostname,module,context,error,err"
  });
}

function getFileStream(opts: LoggerNodeOpts): {stream: NodeJS.WritableStream; level: string} {
  if (!opts.file) {
    throw new Error("File options required");
  }

  if (opts.file.dailyRotate && opts.file.dailyRotate > 0) {
    // Use pino-roll transport for file rotation
    // Note: This requires the transport to be loaded separately
    const transport = pino.transport({
      target: "pino-roll",
      options: {
        file: opts.file.filepath,
        frequency: "daily",
        mkdir: true,
        dateFormat: "yyyy-MM-dd",
        limit: {
          count: opts.file.dailyRotate
        }
      }
    });

    return {
      stream: transport,
      level: levelToPinoLevel[opts.file.level]
    };
  } else {
    // Simple file stream
    const transport = pino.transport({
      target: "pino/file",
      options: {
        destination: opts.file.filepath,
        mkdir: true,
        append: true
      }
    });

    return {
      stream: transport,
      level: levelToPinoLevel[opts.file.level]
    };
  }
}