import type {LoggerOptions as PinoLoggerOptions} from "pino";
import pino from "pino";
import {LogLevel, Logger, LoggerOptions} from "./interface.js";
import {LogData} from "./utils/json.js";

// Map our log levels to pino levels
const levelToPinoLevel: Record<LogLevel, string> = {
  [LogLevel.error]: "error",
  [LogLevel.warn]: "warn",
  [LogLevel.info]: "info",
  [LogLevel.verbose]: "debug",
  [LogLevel.debug]: "debug",
  [LogLevel.trace]: "trace",
};

// Custom levels for pino to match our numbering
const customLevels = {
  error: 10,
  warn: 20,
  info: 30,
  verbose: 35,
  debug: 40,
  trace: 50,
};

export function createPinoLogger(options: Partial<LoggerOptions> = {}, pinoOptions?: PinoLoggerOptions): Logger {
  return PinoLogger.fromOpts(options, pinoOptions);
}

export class PinoLogger implements Logger {
  constructor(protected readonly pino: pino.Logger) {}

  static fromOpts(options: Partial<LoggerOptions> = {}, pinoOptions?: PinoLoggerOptions): PinoLogger {
    return new PinoLogger(PinoLogger.createPinoInstance(options, pinoOptions));
  }

  static createPinoInstance(options: Partial<LoggerOptions> = {}, pinoOptions?: PinoLoggerOptions): pino.Logger {
    const module = options?.module || "";

    // Base pino options
    const baseOptions: PinoLoggerOptions = {
      level: options.level ? levelToPinoLevel[options.level] : "info",
      customLevels,
      useOnlyCustomLevels: false,
      ...pinoOptions,
    };

    // For JSON format, use pino's default
    if (options.format === "json") {
      baseOptions.formatters = {
        level: (label) => {
          // Map pino level back to our level for JSON output
          const ourLevel = Object.keys(levelToPinoLevel).find((key) => levelToPinoLevel[key as LogLevel] === label);
          return {level: ourLevel || label};
        },
        bindings: () => ({module}),
      };
    }

    return pino(baseOptions);
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

  protected createLogEntry(level: LogLevel, message: string, context?: LogData, error?: Error): void {
    const pinoLevel = levelToPinoLevel[level];
    // biome-ignore lint/suspicious/noExplicitAny: Pino log object building
    const logObj: any = {};

    if (context) {
      Object.assign(logObj, {context});
    }

    if (error) {
      logObj.error = error;
      logObj.err = error; // pino convention for errors
    }

    // Call the appropriate pino method
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic method access on pino
    (this.pino as any)[pinoLevel](logObj, message);
  }
}
