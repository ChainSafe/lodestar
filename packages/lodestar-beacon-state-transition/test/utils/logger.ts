import {WinstonLogger, ILogger, LogLevel} from "@chainsafe/lodestar-utils";

export function profilerLogger(): ILogger {
  return new WinstonLogger({level: LogLevel.verbose});
}
