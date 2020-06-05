import {Options} from "yargs";

export const chainPreset: Options = {
  alias: [
    "chain.preset",
    "chain.name",
  ],
  description: "Chain configuration",
  type: "string",
  choices: ["mainnet", "minimal"],
  default: "minimal",
};

export const chainGenesisStateFile: Options = {
  alias: [
    "chain.genesisStateFile",
    "f"
  ],
  description: "Path to genesis state ssz encoded file relative to rootDir",
  type: "string",
  normalize: true,
};

export interface IChainArgs {
  chain?: {
    genesisStateFile?: string;
  };
}
