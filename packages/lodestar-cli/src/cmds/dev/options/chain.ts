import {Options} from "yargs";

// if we import from somewhere it'll print out "undefined" help
export const chainGenesisStateFile: Options = {
  alias: [
    "chain.genesisStateFile",
  ],
  description: "Genesis state in ssz-encoded format",
  type: "string",
  normalize: true,
  group: "chain"
};

export const chainPreset: Options = {
  alias: [
    "chain.preset",
    "chain.name",
  ],
  description: "Specifies the default eth2 spec type",
  type: "string",
  choices: ["mainnet", "minimal"],
  default: "minimal",
  group: "chain"
};

export interface IChainArgs {
  chain?: {
    name?: string;
    genesisStateFile?: string;
  };
}
