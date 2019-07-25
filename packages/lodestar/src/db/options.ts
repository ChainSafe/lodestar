import {IConfigurationModule} from "../util/config";
import {ILoggingOptions} from "../logger/interface";

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
    }
  ]
};

const config: IDatabaseOptions = {
  name: "./lodestar-db",
};

export default config;
