import {Options} from "yargs";

export const chainOptions = {
  "chain.name": {
    alias: ["chain.preset"],
    description: "Chain configuration",
    type: "string",
    choices: ["mainnet", "minimal"],
    default: "mainnet",
  } as Options,
};
