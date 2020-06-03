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
