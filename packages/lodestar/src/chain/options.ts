import {IConfigurationModule} from "../util/config";
import {LogLevel} from "../logger";

export interface IChainOptions {
  name: string;
  loggingLevel?: LogLevel;
}

export const ChainOptions: IConfigurationModule = {
  name: "chain",
  description: "Chain specific configurations",
  fields: [
    {
      name: 'name',
      description: 'Chain preset. Supported values: mainnet, minimal',
      validation: (input) => {
        return input === 'mainnet' || input === 'minimal';
      },
      type: "string",
      configurable: true,
      cli: {
        flag: "chain",
        short: "c"
      }
    },
  ]
};

const config: IChainOptions = {
  name: "mainnet",
  loggingLevel: LogLevel.DEFAULT
};

export default config;
