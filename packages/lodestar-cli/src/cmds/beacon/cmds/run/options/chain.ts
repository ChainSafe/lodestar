import {Options} from "yargs";

export interface ICLIOptions extends Options {
  canonicalAlias?: string;
}

export const chainPreset: ICLIOptions = {
  alias: [
    "chain.preset",
    "chain.name",
  ],
  description: "Chain configuration",
  type: "string",
  choices: ["mainnet", "minimal"],
  default: "mainnet",
};

export const chainGenesisStateFile: ICLIOptions = {
  alias: "chain.genesisStateFile",
  canonicalAlias: "chain.genesisStateFile",
  description: "Genesis state in ssz-encoded format",
  type: "string",
  normalize: true,
};
