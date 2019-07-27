/**
 * @module util/parse
 */

import {LogLevel, Module} from "../logger/abstract";

export function parseLoggingLevel(loggingLevelWithModule: string): LogLevel[]{
  let loggingLevel: LogLevel[];

  if (loggingLevelWithModule) {
    let moduleMapedLogLevel = loggingLevelWithModule.split(',');
    moduleMapedLogLevel.forEach(value => {
      let moduleAndLogLevel = value.split('=');
      loggingLevel[(moduleAndLogLevel[0] || Module.DEFAULT).trim() as Module]
        = (moduleAndLogLevel[1] || LogLevel.DEFAULT).trim() as LogLevel;
    });
  }
  return loggingLevel;
}