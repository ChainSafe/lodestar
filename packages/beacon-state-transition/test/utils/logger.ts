import {WinstonLogger, ILogger} from "@chainsafe/lodestar-utils";

export function profilerLogger(): ILogger {
  return new WinstonLogger();
}
