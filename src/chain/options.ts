import {IConfigurationModule} from "../util/config";
import {number64} from "../types";

export interface IChainOptions {
  name: string;
}

export const ChainOptions: IConfigurationModule = {
  name: "chain",
  description: "Chain specific configurations",
  fields: [
    {
      name: 'name',
      description: 'Chain preset. Supported values: mainnet, minimal',
      validation: (input) => {
        return input === 'mainet' || input === 'minimal';
      },
      type: number64,
      configurable: true,
      cli: {
        flag: "--chain",
        short: "-c"
      }
    }
  ]
};

const config: IChainOptions = {
  name: "mainnet"
};

export default config;
