import {IConfigurationModule} from "../util/config";
import {number64} from "../types";
import {ILoggingOptions} from "../logger/interface";

export interface IChainOptions {
  name: string;
  loggingOptions?: ILoggingOptions;
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
    }
  ]
};

const config: IChainOptions = {
  name: "mainnet"
};

export default config;
