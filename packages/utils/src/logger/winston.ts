import winston from "winston";
import type {Logger} from "winston";
// eslint-disable-next-line import/no-extraneous-dependencies
import {LEVEL} from "triple-beam";
import {ILogger, ILoggerOptions, LoggerChildOpts, LogLevel} from "./interface.js";
import {getFormat} from "./format.js";
import {LogData} from "./json.js";

interface DefaultMeta {
  module: string;
}

interface WinstonTransport {
  parent?: {
    level?: LogLevel;
  };
}

interface LogInfo extends DefaultMeta {
  [LEVEL]: LogLevel;
}

declare module "winston" {
  export interface Logger {
    levelByModule?: Map<string, LogLevel>;
  }
}

export function createWinstonLogger(options: Partial<ILoggerOptions> = {}, transports?: winston.transport[]): ILogger {
  return WinstonLogger.fromOpts(options, transports);
}

export class WinstonLogger implements ILogger {
  constructor(private readonly winston: Logger) {}

  static fromOpts(options: Partial<ILoggerOptions> = {}, transports?: winston.transport[]): WinstonLogger {
    const defaultMeta: DefaultMeta = {module: options?.module || ""};
    const logger = winston.createLogger({
      // Do not set level at the logger level. Always control by Transport
      level: undefined,
      defaultMeta,
      format: getFormat(options),
      transports,
      exitOnError: false,
    });

    logger.levelByModule = new Map<string, LogLevel>();

    return new WinstonLogger(logger);
  }

  error(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.error, message, context, error);
  }

  warn(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.warn, message, context, error);
  }

  info(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.info, message, context, error);
  }

  verbose(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.verbose, message, context, error);
  }

  debug(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.debug, message, context, error);
  }

  silly(message: string, context?: LogData, error?: Error): void {
    this.createLogEntry(LogLevel.silly, message, context, error);
  }

  child(options: LoggerChildOpts): WinstonLogger {
    const parentMeta = this.winston.defaultMeta as DefaultMeta | undefined;
    const childModule = [parentMeta?.module, options.module].filter(Boolean).join("/");
    const defaultMeta: DefaultMeta = {module: childModule};

    // Same strategy as Winston's source .child.
    // However, their implementation of child is to merge info objects where parent takes precedence, so it's
    // impossible for child to overwrite 'module' field. Instead the winston class is cloned as defaultMeta
    // overwritten completely.
    // https://github.com/winstonjs/winston/blob/3f1dcc13cda384eb30fe3b941764e47a5a5efc26/lib/winston/logger.js#L47
    const childWinston = Object.create(this.winston) as typeof this.winston;

    childWinston.defaultMeta = defaultMeta;

    return new WinstonLogger(childWinston);
  }

  setupDynamicLevels(): void {
    // Configure module level custom logger with Winston is not supported out of the box.
    // Log levels are configured at the transport level, and transport instances are shared between child loggers.
    // The simplest solution is to have a Map of module -> log level, and the transports then check if there's
    // some customized value in the map for log info.module

    // Logger goals
    // - Must not run format function if the log won't be used by any transport
    // Logger rules:
    // - console info, file debug, all default, network debug
    // -
    // | --logLevel | --logFileLevel | --LogLevel.db |
    // | info       | debug          |
    //
    // Runtime config of verbosity

    // https://github.com/winstonjs/winston-transport/blob/51baf6138753f0766181355fb50b1b0334344c56/index.js#L80
    //
    // Winston transport base class TransportStream check its own transport level to decide to format then log
    // ```ts
    // TransportStream.prototype._write = function _write(info, enc, callback) {
    //   const level = this.level || (this.parent && this.parent.level);
    //   if (!level || this.levels[level] >= this.levels[info[LEVEL]]) {
    //     transformed = this.format.transform(Object.assign({}, info), this.format.options);
    //     return this.log(transformed, callback);
    //   }
    // };
    // ```

    const levelByModule = this.winston.levelByModule;
    if (!levelByModule) {
      throw Error("levelByModule not set");
    }

    for (const transport of this.winston.transports) {
      // TODO: What's a good default?
      const transportDefaultLevel = transport.level ?? LogLevel.info;
      // Set level and parent to undefined so that underlying transport logs everything
      transport.level = undefined;
      (transport as WinstonTransport).parent = undefined;

      const _writeParent = transport._write.bind(transport);

      // eslint-disable-next-line @typescript-eslint/naming-convention
      transport._write = function _write(info, enc, callback) {
        const levels = (this as Logger).levels;
        const moduleLevel = levelByModule.get((info as LogInfo).module) ?? transportDefaultLevel;

        // Min number is highest prio log level
        // levels = {error: 0, warn: 1, info: 2, ...}

        if (levels[moduleLevel] >= levels[(info as LogInfo)[LEVEL]]) {
          _writeParent(info, enc, callback);
        } else {
          callback(null);
        }
      };
    }
  }

  setModuleLevel(module: string, level: LogLevel): void {
    if (!this.winston.levelByModule) {
      throw Error("levelByModule not set");
    }
    this.winston.levelByModule.set(module, level);
  }

  private createLogEntry(level: LogLevel, message: string, context?: LogData, error?: Error): void {
    // Note: logger does not run format.transform function unless it will actually write the log to the transport

    const moduleLevel = this.winston.levelByModule?.get((this.winston.defaultMeta as DefaultMeta).module);

    // If winston logger is called with `winston.info(message, context, error)` it triggers the "splat" path
    // while we just need winston to forward an object to the custom formatter. So we call the fn signature below
    // https://github.com/winstonjs/winston/blob/3f1dcc13cda384eb30fe3b941764e47a5a5efc26/lib/winston/logger.js#L221
    this.winston.log(level, {message, context, error});
  }
}
