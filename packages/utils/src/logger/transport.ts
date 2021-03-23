import {transports} from "winston";
import {LogLevel} from "./interface";
import TransportStream from "winston-transport";

export enum TransportType {
  console = "console",
  file = "file",
}

export type TransportOpts =
  | {type: TransportType.console; level?: LogLevel}
  | {type: TransportType.file; level?: LogLevel; filename: string};

export function fromTransportOpts(transportOpts: TransportOpts): TransportStream {
  switch (transportOpts.type) {
    case TransportType.console:
      return new transports.Console({
        debugStdout: true,
        level: transportOpts.level,
        handleExceptions: true,
      });

    case TransportType.file:
      return new transports.File({
        level: transportOpts.level,
        filename: transportOpts.filename,
        handleExceptions: true,
      });
  }
}
