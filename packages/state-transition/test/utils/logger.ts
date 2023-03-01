import {createWinstonLogger, Logger} from "@lodestar/utils";

export function profilerLogger(): Logger {
  return createWinstonLogger();
}
