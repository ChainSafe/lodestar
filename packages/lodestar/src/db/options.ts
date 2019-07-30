import {IConfigurationModule} from "../util/config";
import {LogLevel} from "../logger";

export interface IDatabaseOptions {
  name: string;
  loggingLevel?: LogLevel;
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
    }
  ]
};

const config: IDatabaseOptions = {
  name: "./lodestar-db",
  loggingLevel: LogLevel.DEFAULT
};

export default config;
