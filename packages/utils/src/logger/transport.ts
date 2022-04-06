import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import {LogLevel} from "./interface.js";
import TransportStream from "winston-transport";

const {transports} = winston;

export enum TransportType {
  console = "console",
  file = "file",
  stream = "stream",
}

export type TransportOpts =
  | {type: TransportType.console; level?: LogLevel}
  | {type: TransportType.file; level?: LogLevel; filename: string; rotate?: boolean; maxfiles?: number}
  | {type: TransportType.stream; level?: LogLevel; stream: NodeJS.WritableStream};

export function fromTransportOpts(transportOpts: TransportOpts): TransportStream {
  switch (transportOpts.type) {
    case TransportType.console:
      return new transports.Console({
        debugStdout: true,
        level: transportOpts.level,
        handleExceptions: true,
      });

    case TransportType.file:
      return transportOpts.rotate
        ? new DailyRotateFile({
            level: transportOpts.level,
            //insert the date pattern in filename before the file extension.
            filename: transportOpts.filename.replace(/\.(?=[^.]*$)|$/, "-%DATE%$&"),
            datePattern: "YYYY-MM-DD",
            handleExceptions: true,
            maxFiles: transportOpts.maxfiles,
          })
        : new transports.File({
            level: transportOpts.level,
            filename: transportOpts.filename,
            handleExceptions: true,
          });

    case TransportType.stream:
      return new transports.Stream({
        level: transportOpts.level,
        stream: transportOpts.stream,
        handleExceptions: true,
      });
  }
}
