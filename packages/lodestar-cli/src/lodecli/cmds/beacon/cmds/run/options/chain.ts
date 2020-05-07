import {Options} from "yargs";

export const chainPreset: Options = {
  alias: [
    "chain.preset",
    "chain.name",
  ],
  description: "Chain configuration",
  type: "string",
  choices: ["mainnet", "minimal"],
  default: "mainnet",
};

export const chainGenesisStateFile: Options = {
  alias: [
    "chain.genesisStateFile",
  ],
  description: "Genesis state in ssz-encoded format",
  type: "string",
  normalize: true,
};
