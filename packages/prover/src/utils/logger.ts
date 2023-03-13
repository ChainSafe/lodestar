import winston from "winston";
import Transport from "winston-transport";
import {LogData, Logger, LoggerChildOpts, createWinstonLogger} from "@lodestar/utils";
import {LogOptions} from "../interfaces.js";

type BrowserLogLevels = "error" | "warn" | "info" | "debug";

class BrowserConsole extends Transport {
  name = "BrowserConsole";
  private levels: Record<BrowserLogLevels, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 4,
  };

  private methods: Record<BrowserLogLevels, string> = {
    error: "error",
    warn: "warn",
    info: "info",
    debug: "log",
  };

  constructor(opts: winston.transport.TransportStreamOptions | undefined) {
    super(opts);
    this.level = opts?.level && this.levels.hasOwnProperty(opts.level) ? opts.level : "info";
  }

  log(method: string | number, message: unknown): void {
    setImmediate(() => {
      this.emit("logged", method);
    });

    const val = this.levels[method as BrowserLogLevels];
    const mappedMethod = this.methods[method as BrowserLogLevels];

    if (val <= this.levels[this.level as BrowserLogLevels]) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, no-console
      console[mappedMethod](message);
    }
  }
}

const emptyLogger: Logger = {
  // eslint-disable-next-line func-names
  error: function (_message: string, _context?: LogData, _error?: Error | undefined): void {
    // Do nothing
  },
  // eslint-disable-next-line func-names
  warn: function (_message: string, _context?: LogData, _error?: Error | undefined): void {
    // Do nothing
  },
  // eslint-disable-next-line func-names
  info: function (_message: string, _context?: LogData, _error?: Error | undefined): void {
    // Do nothing
  },
  // eslint-disable-next-line func-names
  verbose: function (_message: string, _context?: LogData, _error?: Error | undefined): void {
    // Do nothing
  },
  // eslint-disable-next-line func-names
  debug: function (_message: string, _context?: LogData, _error?: Error | undefined): void {
    // Do nothing
  },
  // eslint-disable-next-line func-names
  child: function (_options: LoggerChildOpts): Logger {
    return emptyLogger;
  },
};

export function getLogger(opts: LogOptions): Logger {
  if (opts.logger) return opts.logger;

  // Code is running in the node environment
  if (opts.logLevel && process !== undefined) {
    return createWinstonLogger({level: opts.logLevel, module: "prover"}, [new winston.transports.Console()]);
  }

  if (opts.logLevel && process === undefined) {
    return createWinstonLogger({level: opts.logLevel, module: "prover"}, [new BrowserConsole({level: opts.logLevel})]);
  }

  // For the case when user don't want to fill in the logs of consumer browser
  return emptyLogger;
}
