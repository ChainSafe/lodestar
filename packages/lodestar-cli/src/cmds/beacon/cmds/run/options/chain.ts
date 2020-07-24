import { IYargsOptionsMap } from "../../../../../util/yargs";

export const chainOptions: IYargsOptionsMap = {
  "chain.name": {
    alias: ["chain.preset"],
    description: "Chain configuration",
    type: "string",
    choices: ["mainnet", "minimal"],
    default: "mainnet",
  },

  "chain.genesisStateFile": {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
  },
};
