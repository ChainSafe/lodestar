/**
 * @module logger
 */

import {LogLevel, Module} from "./abstract";
import {IConfigurationModule} from "../util/config";
import {parseLoggingLevel} from "../util/parse";

export interface ILoggingOptions {
  loggingLevel: Map<Module, LogLevel>;
}


export const LoggingOptions: IConfigurationModule = {
  name: "loggingOptions",
  fields: [
    {
      name: "loggingLevel",
      type: String,
      configurable: true,
      cli: {
        flag: "loggingLevel"
      },
      process: (loggingLevel) => {
        return parseLoggingLevel(loggingLevel);
      },
    }
  ],
};