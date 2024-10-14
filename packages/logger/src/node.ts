import path from "node:path";
import DailyRotateFile from "winston-daily-rotate-file";
import TransportStream from "winston-transport";
// We want to keep `winston` export as it's more readable and easier to understand
/* eslint-disable import/no-named-as-default-member */
import winston from "winston";
import type {Logger as Winston} from "winston";
import {Logger, LogLevel, TimestampFormat} from "./interface.js";
import {ConsoleDynamicLevel} from "./utils/consoleTransport.js";
import {WinstonLogger} from "./winston.js";

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

  if (opts.file) {
    const filename = opts.file.filepath;

    // `lodestar --logFileDailyRotate` -> enable daily rotate with default value
    // `lodestar --logFileDailyRotate 10` -> set daily rotate to custom value 10
    // `lodestar --logFileDailyRotate 0` -> disable daily rotate and accumulate in same file
    const enableDailyRotate = opts.file.dailyRotate != null && opts.file.dailyRotate > 0;

    transports.push(
      enableDailyRotate
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
  constructor(
    protected readonly winston: Winston,
    private readonly opts: LoggerNodeOpts
  ) {
    super(winston);
  }

  static fromOpts(opts: LoggerNodeOpts, transports: winston.transport[]): WinstonLoggerNode {
    return new WinstonLoggerNode(WinstonLoggerNode.createWinstonInstance(opts, transports), opts);
  }

  static fromNewTransports(opts: LoggerNodeOpts): WinstonLoggerNode {
    return WinstonLoggerNode.fromOpts(opts, getNodeLoggerTransports(opts));
  }

  child(opts: LoggerNodeChildOpts): LoggerNode {
    const parentMeta = this.winston.defaultMeta as DefaultMeta | undefined;
    const childModule = [parentMeta?.module, opts.module].filter(Boolean).join("/");
    const childOpts: LoggerNodeOpts = {...this.opts, module: childModule};
    const defaultMeta: DefaultMeta = {module: childModule};

    // Same strategy as Winston's source .child.
    // However, their implementation of child is to merge info objects where parent takes precedence, so it's
    // impossible for child to overwrite 'module' field. Instead the winston class is cloned as defaultMeta
    // overwritten completely.
    // https://github.com/winstonjs/winston/blob/3f1dcc13cda384eb30fe3b941764e47a5a5efc26/lib/winston/logger.js#L47
    const childWinston = Object.create(this.winston) as typeof this.winston;

    childWinston.defaultMeta = defaultMeta;

    return new WinstonLoggerNode(childWinston, childOpts);
  }

  toOpts(): LoggerNodeOpts {
    return this.opts;
  }
}
