import winston from "winston";
import Transport from "winston-transport";
import {LogLevel, Logger} from "@lodestar/utils";
import {createWinstonLogger} from "./winston.js";

export type BrowserLoggerOpts = {
  module?: string;
  level: LogLevel;
};

export function getBrowserLogger(opts: BrowserLoggerOpts): Logger {
  return createWinstonLogger({level: opts.level, module: opts.module ?? ""}, [new BrowserConsole({level: opts.level})]);
}

class BrowserConsole extends Transport {
  name = "BrowserConsole";
  private levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    verbose: 3,
    debug: 4,
    trace: 5,
  };

  private methods: Record<LogLevel, string> = {
    error: "error",
    warn: "warn",
    info: "info",
    verbose: "log",
    debug: "log",
    trace: "log",
  };

  constructor(opts: winston.transport.TransportStreamOptions | undefined) {
    super(opts);
    this.level = opts?.level && this.levels.hasOwnProperty(opts.level) ? opts.level : "info";
  }

  log(method: string | number, message: unknown): void {
    setTimeout(() => {
      this.emit("logged", method);
    }, 0);

    const val = this.levels[method as LogLevel];
    const mappedMethod = this.methods[method as LogLevel];

    if (val <= this.levels[this.level as LogLevel]) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, no-console
      console[mappedMethod](message);
    }
  }
}
