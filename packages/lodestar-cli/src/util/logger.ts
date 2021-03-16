import {WinstonLogger, ILogger, LogLevel} from "@chainsafe/lodestar-utils";

export function errorLogger(): ILogger {
  return new WinstonLogger({level: LogLevel.error});
}
