import {ILogger, WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

export const silentLogger: ILogger = new WinstonLogger({level: LogLevel.error});
silentLogger.silent = true;
