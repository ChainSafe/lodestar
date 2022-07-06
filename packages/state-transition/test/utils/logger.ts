import {WinstonLogger, ILogger} from "@lodestar/utils";

export function profilerLogger(): ILogger {
  return new WinstonLogger();
}
