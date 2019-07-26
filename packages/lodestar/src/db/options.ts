import {IConfigurationModule} from "../util/config";
import {ILoggingOptions} from "../logger/option";
import {parseLoggingLevel} from "../util/parse";
import {LoggingOptions} from "../logger/option";

export interface IDatabaseOptions {
  name: string;
  loggingOptions?: ILoggingOptions;
}

export const DatabaseOptions: IConfigurationModule = {
  name: "db",
  fields: [
    {
      name: "name",
      description: "Path to file database",
      configurable: true,
      type: String,
      cli: {
        flag: 'db',
        short: 'd'
      }
    },
    LoggingOptions
  ]
};

const config: IDatabaseOptions = {
  name: "./lodestar-db",
};

export default config;
