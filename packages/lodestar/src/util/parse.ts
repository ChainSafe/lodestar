/**
 * @module util/parse
 */

import {LogLevel, Module} from "../logger/abstract";

export function parseLoggingLevels(loggingLevelWithModule: string): Map<Module, LogLevel>{
  let loggingLevel: Map<Module, LogLevel>;

  if (loggingLevelWithModule) {
    let moduleMapedLogLevel = loggingLevelWithModule.split(',');
    moduleMapedLogLevel.forEach(value => {
      let moduleAndLogLevel = value.split('=');
      loggingLevel.set((moduleAndLogLevel[0] || Module.DEFAULT).trim() as Module,
        (moduleAndLogLevel[1] || LogLevel.DEFAULT).trim() as LogLevel);
    });
  }
  return loggingLevel;
}