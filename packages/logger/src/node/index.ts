import path from "node:path";
import DailyRotateFile from "winston-daily-rotate-file";
import TransportStream from "winston-transport";
import winston from "winston";
import {Logger, LogLevel, logLevelNum, TimestampFormat} from "../interface.js";
import {getFormat, WinstonLogger} from "../logger/index.js";
import {ConsoleDynamicLevel} from "./consoleTransport.js";

const DATE_PATTERN = "YYYY-MM-DD";

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
  return WinstonLoggerNode.fromNewTransports(opts);
}

function getNodeLoggerTransports(opts: LoggerNodeOpts): winston.transport[] {
  const consoleTransport = new ConsoleDynamicLevel({
    // Set defaultLevel, not level for dynamic level setting of ConsoleDynamicLvevel
    defaultLevel: opts.level,
    debugStdout: true,
    handleExceptions: true,
  });

  if (opts.levelModule) {
    for (const [module, level] of Object.entries(opts.levelModule)) {
      consoleTransport.setModuleLevel(module, level);
    }
  }

  const transports: TransportStream[] = [consoleTransport];

  // yargs populates with undefined if just set but with no arg
  // $ ./bin/lodestar.js beacon --logFileDailyRotate
  // args = {
  //   logFileDailyRotate: undefined,
  // }
  // `lodestar --logFileDailyRotate` -> enabled daily rotate with default value
  // `lodestar --logFileDailyRotate 10` -> set daily rotate to custom value 10
  // `lodestar --logFileDailyRotate 0` -> disable daily rotate and accumulate in same file
  if (opts.file) {
    const filename = opts.file.filepath;

    transports.push(
      opts.file.dailyRotate != null
        ? new DailyRotateFile({
            level: opts.file.level,
            //insert the date pattern in filename before the file extension.
            filename: filename.replace(/\.(?=[^.]*$)|$/, "-%DATE%$&"),
            datePattern: DATE_PATTERN,
            handleExceptions: true,
            maxFiles: opts.file.dailyRotate,
            auditFile: path.join(path.dirname(filename), ".log_rotate_audit.json"),
          })
        : new winston.transports.File({
            level: opts.file.level,
            filename: filename,
            handleExceptions: true,
          })
    );
  }

  return transports;
}

interface DefaultMeta {
  module: string;
}

export class WinstonLoggerNode extends WinstonLogger implements LoggerNode {
  constructor(private readonly opts: LoggerNodeOpts, private readonly transports: winston.transport[]) {
    const defaultMeta: DefaultMeta = {module: opts?.module || ""};
    super(
      winston.createLogger({
        // Do not set level at the logger level. Always control by Transport, unless for testLogger
        level: opts.level,
        defaultMeta,
        format: getFormat(opts),
        transports,
        exitOnError: false,
        levels: logLevelNum,
      })
    );
  }

  static fromNewTransports(opts: LoggerNodeOpts): WinstonLoggerNode {
    return new WinstonLoggerNode(opts, getNodeLoggerTransports(opts));
  }

  // Return a new logger instance with different module and log level
  // but a reference to the same transports, such that there's only one
  // transport instance per tree of child loggers
  child(opts: LoggerNodeChildOpts): LoggerNode {
    return new WinstonLoggerNode(
      {
        ...this.opts,
        module: [this.opts?.module, opts.module].filter(Boolean).join("/"),
      },
      this.transports
    );
  }

  toOpts(): LoggerNodeOpts {
    return this.opts;
  }
}
