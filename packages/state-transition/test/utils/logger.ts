import {createWinstonLogger, ILogger} from "@lodestar/utils";

export function profilerLogger(): ILogger {
  return createWinstonLogger();
}
