import {IConfigurationModule} from "../util/config";

export interface IChainOptions {
  name: string;
  dumpState: boolean;
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
    {
      name: "dumpState",
      description: "dump the state and blocks to disk",
      type: "boolean",
      configurable: true,
      cli: {
        flag: "dump",
      }
    }
  ]
};

const config: IChainOptions = {
  name: "mainnet",
  dumpState: false,
};

export default config;
